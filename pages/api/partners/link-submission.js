import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!supabase) return res.status(500).json({ error: 'Falta configuracion de Supabase' })

  const { partner_agency_id, partner_operation_id, tipo, record_id } = req.body || {}
  if (!partner_agency_id || !partner_operation_id || !tipo || !record_id) {
    return res.status(400).json({ error: 'Faltan parametros' })
  }

  const { data: op, error: opError } = await supabase
    .from('partner_operations')
    .select('id, partner_agency_id, solicitud_inquilino_id, propietario_id')
    .eq('id', partner_operation_id)
    .eq('partner_agency_id', partner_agency_id)
    .maybeSingle()
  if (opError) return res.status(500).json({ error: opError.message })
  if (!op) return res.status(404).json({ error: 'Operacion no encontrada' })

  const update = {
    updated_at: new Date().toISOString(),
  }

  if (tipo === 'inquilino') {
    update.solicitud_inquilino_id = record_id
    update.status_partner = op.propietario_id ? 'en_revision' : 'recibida'
    update.observaciones_publicas = op.propietario_id
      ? 'Solicitud del inquilino y registro del propietario recibidos. Emporio revisara la documentacion.'
      : 'Solicitud del inquilino recibida. Falta recibir el registro del propietario.'
  } else if (tipo === 'propietario') {
    update.propietario_id = record_id
    update.status_partner = op.solicitud_inquilino_id ? 'en_revision' : 'recibida'
    update.observaciones_publicas = op.solicitud_inquilino_id
      ? 'Solicitud del inquilino y registro del propietario recibidos. Emporio revisara la documentacion.'
      : 'Registro del propietario recibido. Falta recibir la solicitud del inquilino.'
  } else {
    return res.status(400).json({ error: 'Tipo invalido' })
  }

  const { error } = await supabase.from('partner_operations').update(update).eq('id', partner_operation_id)
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ok: true })
}
