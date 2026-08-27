import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null
const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.emporioinmobiliario.com.mx'

const esc = (value) => String(value || '—')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

async function authenticate(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return { error: 'Sesion requerida', status: 401 }

  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user) return { error: 'Sesion invalida', status: 401 }

  const { data: perfil, error: perfilError } = await supabase
    .from('profiles')
    .select('id, email, role_id')
    .eq('id', user.id)
    .maybeSingle()

  if (perfilError) return { error: perfilError.message, status: 500 }
  if (!perfil) return { error: 'Perfil no encontrado', status: 403 }
  if (perfil.role_id === 'admin') return { user, perfil }

  const { data: permiso, error: permisoError } = await supabase
    .from('permisos_modulo')
    .select('puede_editar')
    .eq('role_id', perfil.role_id)
    .eq('modulo', 'poliza')
    .maybeSingle()

  if (permisoError) return { error: permisoError.message, status: 500 }
  if (!permiso?.puede_editar) return { error: 'No tienes permiso para aprobar partners', status: 403 }

  return { user, perfil }
}

async function findAuthUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return null

  let page = 1
  while (page <= 10) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const found = (data?.users || []).find((u) => String(u.email || '').toLowerCase() === normalized)
    if (found) return found
    if (!data?.users?.length || data.users.length < 1000) return null
    page += 1
  }
  return null
}

async function sendAccessEmail({ agency, email, actionLink }) {
  if (!process.env.RESEND_API_KEY || !actionLink) return false

  const nombre = agency.nombre_comercial || 'Partner Emporio'
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:28px;background:#f8fafc;">
      <div style="background:#1a1a2e;border-radius:14px 14px 0 0;padding:22px 24px;">
        <p style="margin:0;color:#fca5a5;font-size:12px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">Emporio Blindaje Legal Partner</p>
        <h1 style="margin:8px 0 0;color:#fff;font-size:22px;">Tu acceso fue aprobado</h1>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:24px;">
        <p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.6;">
          ${esc(nombre)} ya puede entrar al Portal Partner para crear operaciones, enviar ligas a clientes y dar seguimiento a sus expedientes.
        </p>
        <a href="${actionLink}" style="display:inline-block;background:#b91c3c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:800;font-size:14px;">
          Entrar al Portal Partner
        </a>
        <p style="margin:18px 0 0;color:#6b7280;font-size:12px;line-height:1.5;">
          Esta liga es personal. Si expira, entra a ${appUrl}/partners/login y solicita una nueva liga de acceso con tu correo.
        </p>
      </div>
    </div>
  `

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'InmoAdmin <cobros@emporioinmobiliario.com.mx>',
      to: [email],
      subject: `Acceso aprobado a Emporio Partner — ${nombre}`,
      html,
    }),
  })

  if (!response.ok) throw new Error(await response.text())
  return true
}

async function ensurePartnerUser(agency) {
  const email = String(agency.email_contacto || '').trim().toLowerCase()
  if (!email) throw new Error('El partner no tiene email de contacto.')

  const { data: existingPartnerUser, error: partnerUserError } = await supabase
    .from('partner_users')
    .select('id, auth_user_id, email')
    .eq('partner_agency_id', agency.id)
    .maybeSingle()
  if (partnerUserError) throw partnerUserError

  let authUser = existingPartnerUser?.auth_user_id
    ? { id: existingPartnerUser.auth_user_id, email }
    : null

  const authUserWithEmail = await findAuthUserByEmail(email)
  if (!existingPartnerUser && authUserWithEmail) {
    throw new Error('Ya existe un usuario con ese email. Revisa manualmente antes de ligarlo como partner.')
  }

  if (!authUser) {
    const created = await supabase.auth.admin.createUser({
      email,
      password: crypto.randomBytes(24).toString('base64url'),
      email_confirm: true,
      user_metadata: {
        nombre: agency.nombre_contacto || agency.nombre_comercial,
        tipo: 'partner',
      },
    })
    if (created.error) throw created.error
    authUser = created.data.user
  }

  if (existingPartnerUser) {
    const { error } = await supabase
      .from('partner_users')
      .update({
        auth_user_id: authUser.id,
        email,
        nombre: agency.nombre_contacto || agency.nombre_comercial,
        active: true,
      })
      .eq('id', existingPartnerUser.id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('partner_users')
      .insert({
        auth_user_id: authUser.id,
        partner_agency_id: agency.id,
        nombre: agency.nombre_contacto || agency.nombre_comercial,
        email,
        role: 'owner',
        active: true,
      })
    if (error) throw error
  }

  await supabase
    .from('profiles')
    .update({
      full_name: agency.nombre_contacto || agency.nombre_comercial,
      active: false,
    })
    .eq('id', authUser.id)

  return { authUser, email }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Metodo no permitido' })
  if (!supabase) return res.status(500).json({ ok: false, error: 'Falta configuracion de Supabase' })

  try {
    const auth = await authenticate(req)
    if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error })

    const { agency_id, status } = req.body || {}
    if (!agency_id) return res.status(400).json({ ok: false, error: 'Falta agency_id' })
    if (!['activo', 'suspendido'].includes(status)) return res.status(400).json({ ok: false, error: 'Status invalido' })

    const { data: agency, error: agencyError } = await supabase
      .from('partner_agencies')
      .select('*')
      .eq('id', agency_id)
      .maybeSingle()
    if (agencyError) throw agencyError
    if (!agency) return res.status(404).json({ ok: false, error: 'Partner no encontrado' })

    let accessUrl = null
    let emailSent = false
    if (status === 'activo') {
      const { email } = await ensurePartnerUser(agency)
      const link = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: `${appUrl}/partners/dashboard` },
      })
      if (link.error) throw link.error
      accessUrl = link.data?.properties?.action_link || null
      if (!accessUrl) throw new Error('No se pudo generar la liga de acceso.')
      emailSent = await sendAccessEmail({ agency, email, actionLink: accessUrl })
    }

    const { error: updateError } = await supabase
      .from('partner_agencies')
      .update({
        status,
        approved_at: status === 'activo' ? new Date().toISOString() : null,
        approved_by: status === 'activo' ? auth.user.id : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', agency_id)
    if (updateError) throw updateError

    return res.status(200).json({ ok: true, status, email_sent: emailSent, access_url: accessUrl })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message })
  }
}
