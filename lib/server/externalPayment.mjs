import { randomBytes } from 'node:crypto'
import { tokenHash } from './partnerInvitations.mjs'

export const paymentUnavailable = 'Esta liga de pago no está disponible.'
export const bankUnavailable = 'Datos de pago temporalmente no disponibles.'
export const validToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
export const checked = result => { if (result.error) throw new Error('database'); return result.data }
export const roleValid = role => ['inquilino', 'propietario'].includes(role)
const newToken = () => randomBytes(32).toString('base64url')

export async function paymentContext(db, token, now = new Date()) {
  if (!validToken(token)) return null
  const access = checked(await db.from('blindaje_case_access_tokens').select('id,case_id,expires_at,revoked_at')
    .eq('token_hash', tokenHash(token)).eq('purpose', 'payment').maybeSingle())
  if (!access || access.revoked_at || new Date(access.expires_at) <= now) return null
  const externalCase = checked(await db.from('blindaje_external_cases').select('id,folio,status').eq('id', access.case_id).maybeSingle())
  if (!externalCase || !['awaiting_payment', 'proof_received'].includes(externalCase.status)) return null
  const payment = checked(await db.from('blindaje_investigation_payments').select('id,status,proof_storage_path').eq('case_id', access.case_id).maybeSingle())
  if (!payment || !['pending', 'proof_received'].includes(payment.status)) return null
  return { access, externalCase, payment }
}

export async function bankAccount(db) {
  const rows = checked(await db.from('cuentas_bancarias').select('banco,titular,clabe').eq('activa', true).eq('uso', 'ventas').limit(2))
  if (rows?.length !== 1 || !rows[0].banco || !rows[0].titular || !rows[0].clabe) return null
  const { banco, titular, clabe } = rows[0]
  return { banco, titular, clabe }
}

// Explicit public projection: never spread a database row into a public response.
export const publicPayment = (context, bank) => ({
  folio: context.externalCase.folio, amount: 1000, currency: 'MXN',
  status: context.payment.status, bank,
})

export function externalPaymentHandler(kind, getDb, enabled = () => process.env.NEXT_PUBLIC_BLINDAJE_EXTERNAL_PAYMENT_I2A_ENABLED === 'true') {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (!enabled()) return res.status(404).json({ error: 'No disponible' })
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Método no permitido' }) }
    try {
      const db = getDb()
      if (!db) return res.status(503).json({ error: 'Servicio temporalmente no disponible' })
      const body = req.body || {}
      if (kind === 'claim') {
        if (!roleValid(body.role) || Object.keys(body).some(key => key !== 'role')) return res.status(400).json({ error: 'Datos inválidos' })
        const token = newToken()
        const expires_at = new Date(Date.now() + 2 * 3600000).toISOString()
        checked(await db.from('blindaje_b2c_submission_tokens').insert({ role: body.role, token_hash: tokenHash(token), expires_at }))
        return res.status(201).json({ token, claim_hash: tokenHash(token), expires_at })
      }
      if (kind === 'b2c' || kind === 'partner') {
        const allowed = kind === 'b2c' ? ['token', 'role'] : ['invitation_token']
        const token = kind === 'b2c' ? body.token : body.invitation_token
        if (Object.keys(body).some(key => !allowed.includes(key)) || !validToken(token) || (kind === 'b2c' && !roleValid(body.role))) return res.status(404).json({ error: paymentUnavailable })
        const paymentToken = newToken()
        // The transaction revalidates all trust/expiry/linking checks under row locks.
        const folio = checked(await db.rpc('blindaje_bootstrap_external_payment', {
          p_kind: kind, p_hash: tokenHash(token), p_role: kind === 'b2c' ? body.role : null, p_payment_hash: tokenHash(paymentToken),
        }))
        if (!folio) return res.status(404).json({ error: paymentUnavailable })
        return res.status(200).json({ folio, payment_token: paymentToken })
      }
      const context = await paymentContext(db, body.token)
      if (!context) return res.status(404).json({ error: paymentUnavailable })
      const bank = await bankAccount(db)
      if (!bank) return res.status(503).json({ error: bankUnavailable })
      checked(await db.from('blindaje_case_access_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', context.access.id))
      return res.status(200).json(publicPayment(context, bank))
    } catch (_) {
      // No request bodies, bearer tokens, PII or raw database errors enter logs.
      return res.status(503).json({ error: 'Servicio temporalmente no disponible' })
    }
  }
}
