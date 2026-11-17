import { createHmac, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// The service key never leaves the server. RLS remains enabled on the owner table.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null
const allowed = [
  'tipo_persona_propietario', 'razon_social_propietario', 'nombre_propietario',
  'telefono_propietario', 'correo_propietario', 'domicilio_propietario',
  'rfc_propietario', 'clave_elector_propietario', 'forma_pago', 'banco', 'clabe',
  'cuenta_bancaria', 'direccion_inmueble', 'tipo_inmueble', 'monto_renta',
  'mantenimiento_incluido', 'mascotas_permitidas', 'detalle_mascotas',
  'num_habitantes', 'reglamento', 'permiso_mudanzas', 'contrato_administracion',
  'origen_operacion', 'asesor_referencia', 'blindaje_submission_claim_hash',
]
const docs = {
  doc_identificacion: 'identificacion',
  doc_comprobante_domicilio: 'comprobante_domicilio',
  doc_predial: 'predial',
  doc_escritura: 'documentos_persona_moral',
}
const extensions = new Set(['pdf', 'jpg', 'jpeg', 'png'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sign = (value) => createHmac('sha256', key).update(value).digest('hex')
const capability = (id) => {
  const expiry = Date.now() + 90 * 60 * 1000
  const body = id + ':' + expiry
  return body + ':' + sign(body)
}
function checkCapability(id, token) {
  if (!uuid.test(id) || typeof token !== 'string') return false
  const parts = token.split(':')
  if (parts.length !== 3 || parts[0] !== id || !/^\d{13}$/.test(parts[1]) || Number(parts[1]) < Date.now()) return false
  const expected = Buffer.from(sign(parts[0] + ':' + parts[1]), 'hex')
  if (!/^[0-9a-f]{64}$/i.test(parts[2])) return false
  return timingSafeEqual(expected, Buffer.from(parts[2], 'hex'))
}
function validFiles(input, required) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Selecciona los documentos.')
  const keys = Object.keys(input)
  if (keys.some((field) => !docs[field])) throw Error('Tipo de documento no permitido.')
  for (const field of required) if (!input[field]) throw Error('Falta un documento obligatorio.')
  for (const ext of Object.values(input)) if (!extensions.has(ext) || typeof ext !== 'string') throw Error('Formato de archivo no permitido.')
  return input
}
const reply = (res, status, message) => res.status(status).json({ error: message })
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return reply(res, 405, 'Método no permitido.')
  if (!db) return reply(res, 503, 'Servicio de registro no configurado.')
  const { action, id, token, files } = req.body || {}
  try {
    if (action === 'start') {
      const p = req.body?.payload
      if (!p || typeof p !== 'object' || Array.isArray(p)) return reply(res, 400, 'Datos incompletos.')
      const payload = Object.fromEntries(allowed.filter(k => Object.prototype.hasOwnProperty.call(p, k)).map(k => [k, p[k]]))
      if (JSON.stringify(payload).length > 13000) return reply(res, 413, 'Datos demasiado extensos.')
      if (!payload.nombre_propietario?.trim() || !payload.correo_propietario?.includes('@') ||
          !payload.telefono_propietario?.trim() || !payload.direccion_inmueble?.trim() ||
          !(Number(payload.monto_renta) > 0)) return reply(res, 400, 'Completa los datos de propietario e inmueble.')
      if (!['fisica','moral'].includes(payload.tipo_persona_propietario)) return reply(res, 400, 'Tipo de propietario inválido.')
      if (payload.tipo_persona_propietario === 'moral' && !payload.razon_social_propietario?.trim())
        return reply(res, 400, 'Falta la razón social.')
      if (payload.origen_operacion && !['emporio','b2c','partner'].includes(payload.origen_operacion))
        return reply(res, 400, 'Origen inválido.')
      if (payload.origen_operacion === 'b2c' && !/^[0-9a-f]{64}$/i.test(payload.blindaje_submission_claim_hash || ''))
        return reply(res, 400, 'Referencia de registro inválida.')
      // Reject unknown database attributes and unbounded input. Never accept IDs or status from callers.
      for (const value of Object.values(payload)) {
        if (typeof value === 'string' && value.length > 1500) return reply(res, 413, 'Un campo es demasiado extenso.')
      }
      const { data, error } = await db.from('propietarios_inmuebles').insert(payload).select('id').single()
      if (error) throw error
      return res.status(200).json({ id: data.id, token: capability(data.id) })
    }
    if (!checkCapability(id, token)) return reply(res, 403, 'Sesión de carga vencida o inválida.')
    if (action === 'sign') {
      const requested = validFiles(files, ['doc_identificacion', 'doc_comprobante_domicilio', 'doc_predial'])
      const { data: row, error: rowError } = await db.from('propietarios_inmuebles').select('id,tipo_persona_propietario').eq('id', id).single()
      if (rowError || !row) return reply(res, 404, 'Registro no disponible.')
      if (row.tipo_persona_propietario === 'moral' && !requested.doc_escritura) return reply(res, 400, 'Falta documentación de la empresa.')
      const uploads = {}
      for (const [field, ext] of Object.entries(requested)) {
        const path = 'propietarios/' + id + '/' + docs[field] + '.' + ext
        const { data, error } = await db.storage.from('poliza-docs').createSignedUploadUrl(path, { upsert: true })
        if (error) throw error
        uploads[field] = { path, token: data.token }
      }
      return res.status(200).json({ uploads })
    }
    if (action === 'finish') {
      const requested = validFiles(files, ['doc_identificacion', 'doc_comprobante_domicilio', 'doc_predial'])
      const { data: row, error: rowError } = await db.from('propietarios_inmuebles')
        .select('id,tipo_persona_propietario').eq('id', id).single()
      if (rowError || !row) return reply(res, 404, 'Registro no disponible.')
      if (row.tipo_persona_propietario === 'moral' && !requested.doc_escritura) return reply(res, 400, 'Falta documentación de la empresa.')
      const folder = 'propietarios/' + id
      const { data: objects, error: listError } = await db.storage.from('poliza-docs').list(folder, { limit: 30 })
      if (listError) throw listError
      const present = new Set((objects || []).filter(f => f.id).map(f => f.name))
      const updates = {}
      for (const [field, ext] of Object.entries(requested)) {
        const name = docs[field] + '.' + ext
        if (!present.has(name)) return reply(res, 409, 'Falta confirmar el archivo: ' + field)
        updates[field + '_b64'] = folder + '/' + name
      }
      const { error } = await db.from('propietarios_inmuebles').update(updates).eq('id', id)
      if (error) throw error
      return res.status(200).json({ ok: true, id })
    }
    return reply(res, 400, 'Operación no permitida.')
  } catch (error) {
    console.error('registro-propietario-publico', action, error)
    return reply(res, 500, 'No se pudo completar el registro. Comunícate con Emporio antes de intentarlo nuevamente.')
  }
}
