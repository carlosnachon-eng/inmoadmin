import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!supabase) return res.status(500).json({ error: 'Falta configuracion de Supabase' })

  const { partner, operacion } = req.query || {}
  if (!partner || !operacion) return res.status(400).json({ error: 'Faltan parametros' })

  const { data: operation, error } = await supabase
    .from('partner_operations')
    .select('id, partner_agency_id, direccion_inmueble, monto_renta, nombre_propietario, nombre_inquilino, partner_agencies:partner_agency_id(id, nombre_comercial, logo_url, brand_color, telefono, email_contacto, status)')
    .eq('id', operacion)
    .eq('partner_agency_id', partner)
    .maybeSingle()

  if (error) return res.status(500).json({ error: error.message })
  if (!operation || operation.partner_agencies?.status !== 'activo') return res.status(404).json({ error: 'Operacion no disponible' })

  return res.status(200).json({
    operation: {
      id: operation.id,
      direccion_inmueble: operation.direccion_inmueble,
      monto_renta: operation.monto_renta,
      nombre_propietario: operation.nombre_propietario,
      nombre_inquilino: operation.nombre_inquilino,
    },
    agency: operation.partner_agencies,
  })
}
