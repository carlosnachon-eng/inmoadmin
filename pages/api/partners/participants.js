import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null

const ROLES = new Set(['propietario_adicional', 'inquilino_adicional', 'obligado_solidario'])

async function getPartner(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return { error: 'No autorizado', status: 401 }

  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user) return { error: 'Sesion invalida', status: 401 }

  const { data: partnerUser, error } = await supabase
    .from('partner_users')
    .select('id, partner_agency_id, active, partner_agencies:partner_agency_id(id, status)')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle()

  if (error) return { error: error.message, status: 500 }
  if (!partnerUser || partnerUser.partner_agencies?.status !== 'activo') return { error: 'Partner no activo', status: 403 }
  return { user, partnerUser, agency: partnerUser.partner_agencies }
}

async function validateOperation(operationId, agencyId) {
  const { data: operation, error } = await supabase
    .from('partner_operations')
    .select('id, partner_agency_id')
    .eq('id', operationId)
    .eq('partner_agency_id', agencyId)
    .maybeSingle()

  if (error) throw error
  return operation
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  if (!supabase) return res.status(500).json({ error: 'Falta configuracion de Supabase' })

  const auth = await getPartner(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  try {
    const operationId = req.method === 'GET' ? req.query.operation_id : req.body?.operation_id
    if (!operationId) return res.status(400).json({ error: 'Falta operation_id' })

    const operation = await validateOperation(operationId, auth.agency.id)
    if (!operation) return res.status(404).json({ error: 'Operacion no encontrada' })

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('partner_participants')
        .select('*')
        .eq('partner_operation_id', operationId)
        .eq('partner_agency_id', auth.agency.id)
        .neq('status', 'cancelado')
        .order('created_at', { ascending: true })
      if (error) throw error
      return res.status(200).json({ ok: true, participants: data || [] })
    }

    const v = req.body || {}
    if (!ROLES.has(v.role)) return res.status(400).json({ error: 'Tipo de participante invalido' })

    const { data, error } = await supabase
      .from('partner_participants')
      .insert({
        partner_agency_id: auth.agency.id,
        partner_operation_id: operationId,
        role: v.role,
        nombre: v.nombre || null,
        email: v.email || null,
        telefono: v.telefono || null,
        notes: v.notes || null,
        created_by: auth.user.id,
      })
      .select('*')
      .single()

    if (error) throw error
    return res.status(200).json({ ok: true, participant: data })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
