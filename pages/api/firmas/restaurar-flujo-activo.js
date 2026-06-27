import { createClient } from '@supabase/supabase-js'
import { getEtapas } from '../../../lib/firmasEtapas'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const PREFIJO_RESPALDO = 'Respaldo antes de migrar al flujo operativo nuevo: '

async function autenticar(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return { error: 'Sesión requerida', status: 401 }

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return { error: 'Sesión inválida', status: 401 }

  const { data: perfil } = await supabase
    .from('profiles')
    .select('id, full_name, email, role_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!perfil || !['admin', 'gerente_ventas'].includes(perfil.role_id)) {
    return { error: 'No tienes permiso para restaurar flujos activos', status: 403 }
  }

  return { user, perfil }
}

function parsearRespaldo(comentarios = []) {
  const respaldo = comentarios.find(c => String(c.mensaje || '').startsWith(PREFIJO_RESPALDO))
  if (!respaldo) return null

  try {
    return JSON.parse(String(respaldo.mensaje).slice(PREFIJO_RESPALDO.length))
  } catch {
    return null
  }
}

function normalizarStatus(status) {
  return ['pendiente', 'en_proceso', 'completada', 'no_aplica', 'bloqueada'].includes(status)
    ? status
    : 'pendiente'
}

function etapaActual(etapas) {
  const pendiente = etapas
    .filter(etapa => !['completada', 'no_aplica'].includes(etapa.status))
    .sort((a, b) => a.orden - b.orden)[0]
  return pendiente?.orden || etapas[etapas.length - 1]?.orden || 1
}

function reconstruirDesdeRespaldo(firma, respaldo = []) {
  const etapasVigentes = getEtapas(firma.tipo, firma.es_contado || false)
  const respaldoPorClave = new Map(respaldo.map(etapa => [etapa.clave, etapa]))

  return etapasVigentes.map(etapaVigente => {
    const anterior = respaldoPorClave.get(etapaVigente.clave)
    const status = anterior ? normalizarStatus(anterior.status) : etapaVigente.status || 'pendiente'
    const completada = status === 'completada'

    return {
      firma_id: firma.id,
      orden: etapaVigente.orden,
      clave: etapaVigente.clave,
      nombre: etapaVigente.nombre,
      responsable: etapaVigente.responsable,
      status,
      notas: anterior?.notas || null,
      completada_at: completada ? anterior?.completada_at || null : null,
      completada_por: null,
    }
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const auth = await autenticar(req)
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error })

  const { dryRun = false } = req.body || {}

  const { data: firmas, error } = await supabase
    .from('firmas')
    .select('id, titulo, tipo, es_contado, status, firma_etapas(*)')
    .eq('status', 'activo')
    .in('tipo', ['arrendamiento', 'compraventa'])
    .order('created_at', { ascending: true })

  if (error) return res.status(500).json({ ok: false, error: error.message })

  const candidatas = []
  for (const firma of firmas || []) {
    const { data: comentarios } = await supabase
      .from('firma_comentarios')
      .select('id, mensaje, created_at')
      .eq('firma_id', firma.id)
      .ilike('mensaje', `${PREFIJO_RESPALDO}%`)
      .order('created_at', { ascending: false })
      .limit(1)

    const respaldo = parsearRespaldo(comentarios || [])
    const etapasNuevas = respaldo ? reconstruirDesdeRespaldo(firma, respaldo) : []
    if (respaldo && etapasNuevas.length > 0) {
      candidatas.push({ firma, respaldo, etapasNuevas })
    }
  }

  const resumen = candidatas.map(({ firma, respaldo, etapasNuevas }) => ({
    id: firma.id,
    titulo: firma.titulo,
    tipo: firma.tipo,
    etapas_respaldo: respaldo.length,
    etapas_restauradas: etapasNuevas.length,
    etapa_actual_nueva: etapaActual(etapasNuevas),
  }))

  if (dryRun) {
    return res.status(200).json({
      ok: true,
      dryRun: true,
      total_activas: firmas?.length || 0,
      total_por_restaurar: candidatas.length,
      resumen,
    })
  }

  const resultados = []

  for (const item of candidatas) {
    const { firma, etapasNuevas } = item
    const idsActuales = (firma.firma_etapas || []).map(etapa => etapa.id).filter(Boolean)

    const { error: insertError } = await supabase.from('firma_etapas').insert(etapasNuevas)
    if (insertError) {
      resultados.push({ id: firma.id, ok: false, error: insertError.message })
      continue
    }

    if (idsActuales.length > 0) {
      const { error: deleteError } = await supabase
        .from('firma_etapas')
        .delete()
        .in('id', idsActuales)

      if (deleteError) {
        resultados.push({ id: firma.id, ok: false, error: deleteError.message })
        continue
      }
    }

    const nuevaEtapaActual = etapaActual(etapasNuevas)
    await supabase
      .from('firmas')
      .update({ etapa_actual: nuevaEtapaActual })
      .eq('id', firma.id)

    await supabase.from('firma_comentarios').insert({
      firma_id: firma.id,
      usuario_id: auth.user.id,
      usuario_nombre: auth.perfil.full_name || auth.perfil.email || auth.user.email || 'Sistema',
      mensaje: `Flujo restaurado al formato completo usando respaldo de bitácora. Nueva etapa actual: ${nuevaEtapaActual}.`,
      tipo: 'cambio_etapa',
    })

    resultados.push({ id: firma.id, ok: true, etapa_actual: nuevaEtapaActual })
  }

  return res.status(200).json({
    ok: true,
    dryRun: false,
    total_activas: firmas?.length || 0,
    total_restauradas: resultados.filter(r => r.ok).length,
    total_errores: resultados.filter(r => !r.ok).length,
    resumen,
    resultados,
  })
}
