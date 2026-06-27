import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null

function calcPolicyPrice(rent) {
  const amount = Number(rent) || 0
  if (!amount) return null
  if (amount <= 7000) return 2800
  if (amount <= 10000) return 3200
  if (amount <= 15000) return 3800
  if (amount <= 20000) return 4500
  if (amount <= 25000) return 5200
  if (amount <= 30000) return 6100
  if (amount <= 40000) return 9500
  if (amount <= 50000) return 12500
  return Math.round(amount * 0.25 * 100) / 100
}

async function getPartner(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return { error: 'No autorizado', status: 401 }

  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user) return { error: 'Sesion invalida', status: 401 }

  const { data: partnerUser, error } = await supabase
    .from('partner_users')
    .select('id, partner_agency_id, active, partner_agencies:partner_agency_id(id, nombre_comercial, commission_rate, status)')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle()

  if (error) return { error: error.message, status: 500 }
  if (!partnerUser || partnerUser.partner_agencies?.status !== 'activo') return { error: 'Partner no activo', status: 403 }
  return { user, partnerUser, agency: partnerUser.partner_agencies }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!supabase) return res.status(500).json({ error: 'Falta configuracion de Supabase' })

  const auth = await getPartner(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  try {
    const v = req.body || {}
    if (!v.nombre_propietario || !v.nombre_inquilino || !v.direccion_inmueble) {
      return res.status(400).json({ error: 'Completa propietario, inquilino y direccion del inmueble.' })
    }

    const montoRenta = Number(v.monto_renta) || null
    const montoPoliza = calcPolicyPrice(montoRenta)
    const commissionRate = Number(auth.agency.commission_rate || 0.2)
    const commissionEstimated = Math.round((Number(montoPoliza) || 0) * commissionRate * 100) / 100

    const { data: operation, error: opError } = await supabase
      .from('partner_operations')
      .insert({
        partner_agency_id: auth.agency.id,
        created_by: auth.user.id,
        status_partner: 'recibida',
        nombre_propietario: v.nombre_propietario,
        telefono_propietario: v.telefono_propietario || null,
        correo_propietario: v.correo_propietario || null,
        nombre_inquilino: v.nombre_inquilino,
        telefono_inquilino: v.telefono_inquilino || null,
        correo_inquilino: v.correo_inquilino || null,
        direccion_inmueble: v.direccion_inmueble,
        monto_renta: montoRenta,
        monto_poliza_estimado: montoPoliza,
        commission_rate: commissionRate,
        commission_estimated: commissionEstimated,
        observaciones_publicas: 'Operacion creada. Comparte las ligas personalizadas con propietario e inquilino para que llenen sus formularios.',
        observaciones_internas: v.notas_partner || null,
      })
      .select('id')
      .single()
    if (opError) throw opError

    return res.status(200).json({ operation_id: operation.id })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
