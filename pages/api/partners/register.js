import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null

const cleanHex = (value) => /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#b91c3c'
const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.emporioinmobiliario.com.mx'
const allowedLogoTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])

const esc = (value) => String(value || '—')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

async function notifyPartnerRequest({ agencyId, values, email }) {
  if (!process.env.RESEND_API_KEY) return

  const nombre = values.nombre_comercial || 'Nuevo partner'
  const contacto = values.nombre_contacto || values.nombre_comercial || '—'
  const telefono = values.telefono || '—'
  const ciudad = values.ciudad || '—'
  const website = values.website || '—'
  const adminUrl = `${appUrl}/poliza/partners`

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:28px;background:#f8fafc;">
      <div style="background:#1a1a2e;border-radius:14px 14px 0 0;padding:22px 24px;">
        <p style="margin:0;color:#fca5a5;font-size:12px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">Emporio Blindaje Legal Partner</p>
        <h1 style="margin:8px 0 0;color:#fff;font-size:22px;">Nueva solicitud para ser partner</h1>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:24px;">
        <p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.6;">
          Se registró una inmobiliaria/asesor y está pendiente de aprobación interna.
        </p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
          <tr><td style="padding:10px;color:#6b7280;font-size:12px;font-weight:800;text-transform:uppercase;">Nombre comercial</td><td style="padding:10px;font-weight:700;color:#111827;">${esc(nombre)}</td></tr>
          <tr style="background:#f9fafb;"><td style="padding:10px;color:#6b7280;font-size:12px;font-weight:800;text-transform:uppercase;">Contacto</td><td style="padding:10px;color:#374151;">${esc(contacto)}</td></tr>
          <tr><td style="padding:10px;color:#6b7280;font-size:12px;font-weight:800;text-transform:uppercase;">Correo</td><td style="padding:10px;color:#374151;">${esc(email)}</td></tr>
          <tr style="background:#f9fafb;"><td style="padding:10px;color:#6b7280;font-size:12px;font-weight:800;text-transform:uppercase;">Teléfono</td><td style="padding:10px;color:#374151;">${esc(telefono)}</td></tr>
          <tr><td style="padding:10px;color:#6b7280;font-size:12px;font-weight:800;text-transform:uppercase;">Ciudad</td><td style="padding:10px;color:#374151;">${esc(ciudad)}</td></tr>
          <tr style="background:#f9fafb;"><td style="padding:10px;color:#6b7280;font-size:12px;font-weight:800;text-transform:uppercase;">Web / redes</td><td style="padding:10px;color:#374151;">${esc(website)}</td></tr>
        </table>
        <a href="${adminUrl}" style="display:inline-block;background:#b91c3c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:800;font-size:14px;">
          Revisar y aprobar partner
        </a>
        <p style="margin:18px 0 0;color:#9ca3af;font-size:12px;">ID partner_agency: ${esc(agencyId)}</p>
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
      to: ['carlos.nachon@emporioinmobiliario.mx', 'juridico@emporioinmobiliario.mx'],
      subject: `Nueva solicitud Partner — ${nombre}`,
      html,
    }),
  })

  if (!response.ok) throw new Error(await response.text())
}

async function uploadPartnerLogo(agencyId, logoFile) {
  if (!logoFile?.dataUrl) return null
  if (!allowedLogoTypes.has(logoFile.type)) throw new Error('El logo debe ser PNG, JPG o WebP.')
  if (Number(logoFile.size || 0) > 2 * 1024 * 1024) throw new Error('El logo no debe pesar mas de 2 MB.')

  const match = String(logoFile.dataUrl).match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/)
  if (!match) throw new Error('El logo no tiene un formato valido.')

  const ext = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1]
  const buffer = Buffer.from(match[2], 'base64')
  const path = `partner-logos/${agencyId}.${ext}`

  const { error } = await supabase.storage
    .from('documentos')
    .upload(path, buffer, { contentType: match[1], upsert: true })
  if (error) throw error

  const { data } = supabase.storage.from('documentos').getPublicUrl(path)
  return data?.publicUrl || null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!supabase) return res.status(500).json({ error: 'Falta configuracion de Supabase' })

  try {
    const v = req.body || {}
    if (!v.nombre_comercial || !v.email || !v.password) {
      return res.status(400).json({ error: 'Completa nombre comercial, email y contrasena.' })
    }
    if (String(v.password).length < 8) {
      return res.status(400).json({ error: 'La contrasena debe tener al menos 8 caracteres.' })
    }

    const email = String(v.email).trim().toLowerCase()
    const { data: existingUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const existing = (existingUsers?.users || []).find(u => u.email === email)
    if (existing) return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' })

    const created = await supabase.auth.admin.createUser({
      email,
      password: v.password,
      email_confirm: true,
      user_metadata: {
        nombre: v.nombre_contacto || v.nombre_comercial,
        tipo: 'partner',
      },
    })
    if (created.error) throw created.error

    const agencyInsert = await supabase
      .from('partner_agencies')
      .insert({
        nombre_comercial: v.nombre_comercial,
        razon_social: v.razon_social || null,
        rfc: v.rfc || null,
        email_contacto: email,
        telefono: v.telefono || null,
        ciudad: v.ciudad || null,
        website: v.website || null,
        logo_url: v.logo_url || null,
        brand_color: cleanHex(v.brand_color),
        commission_rate: 0.20,
        status: 'pendiente',
      })
      .select('id')
      .single()
    if (agencyInsert.error) throw agencyInsert.error

    const uploadedLogoUrl = await uploadPartnerLogo(agencyInsert.data.id, v.logo_file)
    if (uploadedLogoUrl) {
      const logoUpdate = await supabase
        .from('partner_agencies')
        .update({ logo_url: uploadedLogoUrl, updated_at: new Date().toISOString() })
        .eq('id', agencyInsert.data.id)
      if (logoUpdate.error) throw logoUpdate.error
    }

    const userInsert = await supabase
      .from('partner_users')
      .insert({
        auth_user_id: created.data.user.id,
        partner_agency_id: agencyInsert.data.id,
        nombre: v.nombre_contacto || v.nombre_comercial,
        email,
        role: 'owner',
        active: true,
      })
    if (userInsert.error) throw userInsert.error

    const profileUpdate = await supabase
      .from('profiles')
      .update({
        full_name: v.nombre_contacto || v.nombre_comercial,
        active: false,
      })
      .eq('id', created.data.user.id)
    if (profileUpdate.error) console.error('No se pudo aislar profile partner:', profileUpdate.error.message)

    try {
      await notifyPartnerRequest({ agencyId: agencyInsert.data.id, values: v, email })
    } catch (notifyError) {
      console.error('Error notificando solicitud partner:', notifyError.message)
    }

    return res.status(200).json({ ok: true })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
