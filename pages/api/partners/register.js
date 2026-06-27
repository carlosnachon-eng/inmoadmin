import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null

const cleanHex = (value) => /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#b91c3c'

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

    return res.status(200).json({ ok: true })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
