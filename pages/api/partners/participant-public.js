import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null

const allowedDocTypes = new Set(['application/pdf', 'image/png', 'image/jpeg'])

function parseDoc(file) {
  if (!file?.dataUrl) return null
  if (!allowedDocTypes.has(file.type)) throw new Error('Los documentos deben ser PDF, JPG o PNG.')
  if (Number(file.size || 0) > 12 * 1024 * 1024) throw new Error('Cada documento debe pesar menos de 12 MB.')
  const match = String(file.dataUrl).match(/^data:(application\/pdf|image\/png|image\/jpeg);base64,(.+)$/)
  if (!match) throw new Error('Documento invalido.')
  const ext = match[1] === 'application/pdf' ? 'pdf' : (match[1] === 'image/png' ? 'png' : 'jpg')
  return { contentType: match[1], ext, buffer: Buffer.from(match[2], 'base64') }
}

async function loadContext({ partner, operacion, participante }) {
  const { data: operation, error } = await supabase
    .from('partner_operations')
    .select('id, partner_agency_id, direccion_inmueble, monto_renta, nombre_propietario, nombre_inquilino, partner_agencies:partner_agency_id(id, nombre_comercial, logo_url, brand_color, telefono, email_contacto, status)')
    .eq('id', operacion)
    .eq('partner_agency_id', partner)
    .maybeSingle()
  if (error) throw error
  if (!operation || operation.partner_agencies?.status !== 'activo') return null

  const { data: participant, error: participantError } = await supabase
    .from('partner_participants')
    .select('*')
    .eq('id', participante)
    .eq('partner_operation_id', operacion)
    .eq('partner_agency_id', partner)
    .neq('status', 'cancelado')
    .maybeSingle()
  if (participantError) throw participantError
  if (!participant) return null

  return { operation, participant, agency: operation.partner_agencies }
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  if (!supabase) return res.status(500).json({ error: 'Falta configuracion de Supabase' })

  try {
    const source = req.method === 'GET' ? req.query : req.body
    const { partner, operacion, participante } = source || {}
    if (!partner || !operacion || !participante) return res.status(400).json({ error: 'Faltan parametros' })

    const ctx = await loadContext({ partner, operacion, participante })
    if (!ctx) return res.status(404).json({ error: 'Participante no disponible' })

    if (req.method === 'GET') {
      return res.status(200).json({
        operation: {
          id: ctx.operation.id,
          direccion_inmueble: ctx.operation.direccion_inmueble,
          monto_renta: ctx.operation.monto_renta,
          nombre_propietario: ctx.operation.nombre_propietario,
          nombre_inquilino: ctx.operation.nombre_inquilino,
        },
        agency: ctx.agency,
        participant: {
          id: ctx.participant.id,
          role: ctx.participant.role,
          nombre: ctx.participant.nombre,
          email: ctx.participant.email,
          telefono: ctx.participant.telefono,
          status: ctx.participant.status,
        },
      })
    }

    if (ctx.participant.role !== 'obligado_solidario') {
      return res.status(400).json({ error: 'Este formulario es solo para obligado solidario.' })
    }

    const { values = {}, files = {} } = req.body || {}
    const docs = []
    for (const [key, file] of Object.entries(files || {})) {
      const parsed = parseDoc(file)
      if (!parsed) continue
      const path = `partners/${partner}/${operacion}/participants/${participante}/${key}-${Date.now()}.${parsed.ext}`
      const { error: uploadError } = await supabase.storage
        .from('poliza-docs')
        .upload(path, parsed.buffer, { contentType: parsed.contentType, upsert: true })
      if (uploadError) throw uploadError
      docs.push({ key, name: file.name || key, storage_path: path, content_type: parsed.contentType })
    }

    const { error: updateError } = await supabase
      .from('partner_participants')
      .update({
        nombre: values.nombre || ctx.participant.nombre || null,
        email: values.email || ctx.participant.email || null,
        telefono: values.telefono || ctx.participant.telefono || null,
        status: 'recibido',
        data_json: values,
        docs_json: docs,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', participante)
  if (updateError) throw updateError

    return res.status(200).json({ ok: true })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
