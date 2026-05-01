import { createClient } from '@supabase/supabase-js'
import { getEtapas } from '../../../lib/firmasEtapas'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const {
    tipo, titulo, direccion, nombre_comprador, nombre_vendedor,
    monto_apartado, forma_pago, propietario_asiste, modalidad_firma,
    fecha_apartado, urgente, es_contado, easybroker_id, creado_por,
    creado_por_nombre
  } = req.body

  // 1. Crear expediente
  const { data: firma, error } = await supabase
    .from('firmas')
    .insert({
      tipo, titulo, direccion, nombre_comprador, nombre_vendedor,
      monto_apartado, forma_pago, propietario_asiste, modalidad_firma,
      fecha_apartado, urgente, es_contado: es_contado || false,
      easybroker_id, creado_por, etapa_actual: 1, status: 'activo'
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  // 2. Crear etapas según tipo
  const etapas = getEtapas(tipo, es_contado)
  const etapasInsert = etapas.map(e => ({
    firma_id: firma.id,
    orden: e.orden,
    clave: e.clave,
    nombre: e.nombre,
    responsable: e.responsable,
    status: e.status,
  }))

  await supabase.from('firma_etapas').insert(etapasInsert)

  // 3. Comentario inicial en bitácora
  await supabase.from('firma_comentarios').insert({
    firma_id: firma.id,
    usuario_nombre: creado_por_nombre || 'Sistema',
    mensaje: `Expediente creado. Tipo: ${tipo}. ${es_contado ? 'Operacion de contado.' : ''}`,
    tipo: 'cambio_etapa'
  })

  return res.status(200).json({ firma })
}
