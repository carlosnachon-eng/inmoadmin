import { createHash, randomBytes } from 'node:crypto'

export const INVITATION_DAYS = 30
export const unavailable = 'Esta invitación ya no está disponible. Solicita una nueva liga a tu inmobiliaria.'
export const tokenHash = token => createHash('sha256').update(token).digest('hex')
const tokenValid = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const roleValid = role => ['inquilino', 'propietario'].includes(role)
const checked = result => { if (result.error) throw new Error('database'); return result.data }

export async function invitationContext(db, token, now = new Date()) {
  if (!tokenValid(token)) return null
  const invitation = checked(await db.from('blindaje_partner_invitations')
    .select('id, partner_agency_id, partner_operation_id, role, expires_at, revoked_at')
    .eq('token_hash', tokenHash(token)).maybeSingle())
  if (!invitation || invitation.revoked_at || new Date(invitation.expires_at) <= now) return null
  const operation = checked(await db.from('partner_operations')
    .select('id, partner_agency_id, direccion_inmueble, monto_renta, nombre_propietario, nombre_inquilino')
    .eq('id', invitation.partner_operation_id).eq('partner_agency_id', invitation.partner_agency_id).maybeSingle())
  if (!operation) return null
  const agency = checked(await db.from('partner_agencies')
    .select('nombre_comercial, logo_url, brand_color, status').eq('id', invitation.partner_agency_id).maybeSingle())
  if (!agency || agency.status !== 'activo') return null
  return { invitation, operation, agency }
}

export function publicContext({ invitation, operation, agency }) {
  return { valid: true, role: invitation.role,
    agency: { nombre_comercial: agency.nombre_comercial, logo_url: agency.logo_url, brand_color: agency.brand_color },
    operation: { direccion_inmueble: operation.direccion_inmueble, monto_renta: operation.monto_renta,
      nombre_propietario: operation.nombre_propietario, nombre_inquilino: operation.nombre_inquilino } }
}

export function invitationHandler(kind, getDb, enabled = () => process.env.NEXT_PUBLIC_BLINDAJE_PARTNER_INVITATIONS_ENABLED === 'true') {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (!enabled()) return res.status(404).json({ error: 'No disponible' })
    const methods = kind === 'manage' ? ['POST', 'DELETE'] : ['POST']
    if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); return res.status(405).json({ error: 'Método no permitido' }) }
    try {
      const db = getDb()
      if (!db) return res.status(503).json({ error: 'Servicio temporalmente no disponible' })
      const body = req.body || {}
      if (kind === 'manage') {
        const header = req.headers.authorization || ''
        if (!header.startsWith('Bearer ') || !header.slice(7)) return res.status(401).json({ error: 'No autorizado' })
        const auth = await db.auth.getUser(header.slice(7))
        if (auth.error || !auth.data?.user) return res.status(401).json({ error: 'No autorizado' })
        const user = auth.data.user
        const member = checked(await db.from('partner_users').select('partner_agency_id, active').eq('auth_user_id', user.id).eq('active', true).maybeSingle())
        if (!member || !member.active) return res.status(403).json({ error: 'No autorizado' })
        const agency = checked(await db.from('partner_agencies').select('status').eq('id', member.partner_agency_id).maybeSingle())
        if (agency?.status !== 'activo') return res.status(403).json({ error: 'No autorizado' })
        if (!uuid(body.operation_id) || !roleValid(body.role)) return res.status(400).json({ error: 'Datos inválidos' })
        const operation = checked(await db.from('partner_operations').select('id').eq('id', body.operation_id).eq('partner_agency_id', member.partner_agency_id).maybeSingle())
        if (!operation) return res.status(404).json({ error: 'Operación no disponible' })
        if (req.method === 'DELETE') {
          checked(await db.from('blindaje_partner_invitations').update({ revoked_at: new Date().toISOString() })
            .eq('partner_operation_id', operation.id).eq('partner_agency_id', member.partner_agency_id).eq('role', body.role).is('revoked_at', null))
          return res.status(200).json({ ok: true })
        }
        const token = randomBytes(32).toString('base64url')
        const expires_at = new Date(Date.now() + INVITATION_DAYS * 86400000).toISOString()
        checked(await db.from('blindaje_partner_invitations').insert({ partner_agency_id: member.partner_agency_id,
          partner_operation_id: operation.id, role: body.role, token_hash: tokenHash(token), expires_at, created_by: user.id }))
        return res.status(201).json({ token, role: body.role, expires_at })
      }
      const context = await invitationContext(db, body.token)
      if (!context) return res.status(404).json({ error: unavailable })
      if (kind === 'public') return res.status(200).json(publicContext(context))
      if (body.tipo !== context.invitation.role || !uuid(body.record_id)) return res.status(404).json({ error: unavailable })
      // Transaction revalidates the token and locks the invitation/operation before linking.
      const linked = checked(await db.rpc('blindaje_link_invited_submission', { p_token_hash: tokenHash(body.token), p_tipo: body.tipo, p_record_id: body.record_id }))
      if (!linked) return res.status(404).json({ error: unavailable })
      return res.status(200).json({ ok: true })
    } catch (_) {
      // Never log request bodies, bearer credentials or database errors.
      return res.status(503).json({ error: 'Servicio temporalmente no disponible' })
    }
  }
}
