import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null

const normalizeRfc = (value = '') => String(value).trim().toUpperCase().replace(/[^A-Z0-9Ñ&]/g, '')
const normalizeEmail = (value = '') => String(value).trim().toLowerCase()
const normalizePhone = (value = '') => String(value).replace(/\D/g, '')

const maskEmail = (email = '') => {
  const clean = normalizeEmail(email)
  const [user, domain] = clean.split('@')
  if (!user || !domain) return ''
  return `${user.slice(0, 2)}***@${domain}`
}

const maskPhone = (phone = '') => {
  const clean = normalizePhone(phone)
  if (clean.length < 4) return ''
  return `${'*'.repeat(Math.max(0, clean.length - 4))}${clean.slice(-4)}`
}

const allowedFields = (row) => ({
  tipo_persona_propietario: row.tipo_persona_propietario || 'fisica',
  razon_social_propietario: row.razon_social_propietario || '',
  nombre_propietario: row.nombre_propietario || '',
  telefono_propietario: row.telefono_propietario || '',
  correo_propietario: row.correo_propietario || '',
  domicilio_propietario: row.domicilio_propietario || '',
  rfc_propietario: row.rfc_propietario || '',
})

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!supabase) return res.status(500).json({ error: 'Falta configuracion de Supabase' })

  const rfc = normalizeRfc(req.body?.rfc)
  const correo = normalizeEmail(req.body?.correo)
  const telefono = normalizePhone(req.body?.telefono)

  if (!rfc || (!correo && !telefono)) {
    return res.status(400).json({ error: 'Para buscar datos previos se requiere RFC y correo o telefono.' })
  }

  const { data, error } = await supabase
    .from('propietarios_inmuebles')
    .select('id, created_at, tipo_persona_propietario, razon_social_propietario, nombre_propietario, telefono_propietario, correo_propietario, domicilio_propietario, rfc_propietario')
    .ilike('rfc_propietario', rfc)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) return res.status(500).json({ error: error.message })

  const match = (data || []).find((row) => {
    const sameEmail = correo && normalizeEmail(row.correo_propietario) === correo
    const samePhone = telefono && normalizePhone(row.telefono_propietario) === telefono
    return sameEmail || samePhone
  })

  if (!match) return res.status(200).json({ found: false })

  return res.status(200).json({
    found: true,
    summary: {
      nombre: match.tipo_persona_propietario === 'moral'
        ? (match.razon_social_propietario || match.nombre_propietario || '')
        : (match.nombre_propietario || ''),
      rfc: `${rfc.slice(0, 3)}***${rfc.slice(-3)}`,
      correo: maskEmail(match.correo_propietario),
      telefono: maskPhone(match.telefono_propietario),
    },
    values: allowedFields(match),
  })
}
