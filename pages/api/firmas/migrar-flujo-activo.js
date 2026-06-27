import { createClient } from '@supabase/supabase-js'
import { getEtapas } from '../../../lib/firmasEtapas'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LEGACY_CLAVES = {
  arrendamiento: ['habilitacion'],
  compraventa: ['apartado', 'datos_comprador', 'contrato', 'revision', 'cambios', 'credito', 'avaluo', 'expediente_banco'],
}

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
    return { error: 'No tienes permiso para actualizar flujos activos', status: 403 }
  }

  return { user, perfil }
}

function normalizarStatus(status) {
  return ['pendiente', 'en_proceso', 'completada', 'no_aplica', 'bloqueada'].includes(status)
    ? status
    : 'pendiente'
}

function etapaPorClave(etapas, clave) {
  return etapas.find(etapa => etapa.clave === clave)
}

function primeraEtapa(etapas, claves) {
  return claves.map(clave => etapaPorClave(etapas, clave)).find(Boolean)
}

function estadoDesdeEtapas(etapas, claves) {
  const candidatas = claves.map(clave => etapaPorClave(etapas, clave)).filter(Boolean)
  if (candidatas.some(etapa => etapa.status === 'completada')) return 'completada'
  if (candidatas.some(etapa => etapa.status === 'en_proceso')) return 'en_proceso'
  if (candidatas.some(etapa => etapa.status === 'bloqueada')) return 'bloqueada'
  return 'pendiente'
}

function datosBase(etapaNueva, etapaOrigen, status) {
  const completada = status === 'completada'
  return {
    orden: etapaNueva.orden,
    clave: etapaNueva.clave,
    nombre: etapaNueva.nombre,
    responsable: etapaNueva.responsable,
    status,
    notas: etapaOrigen?.notas || null,
    completada_por: completada ? etapaOrigen?.completada_por || null : null,
    completada_at: completada ? etapaOrigen?.completada_at || null : null,
  }
}

function mapearEtapaArrendamiento(etapaNueva, etapasActuales) {
  const origenExacto = etapaPorClave(etapasActuales, etapaNueva.clave)
  if (origenExacto) return datosBase(etapaNueva, origenExacto, normalizarStatus(origenExacto.status))

  if (etapaNueva.clave === 'coordinacion_entrega') {
    const habilitacion = etapaPorClave(etapasActuales, 'habilitacion')
    if (habilitacion) return datosBase(etapaNueva, habilitacion, normalizarStatus(habilitacion.status))
  }

  return datosBase(etapaNueva, null, etapaNueva.status || 'pendiente')
}

function mapearEtapaCompraventa(etapaNueva, etapasActuales) {
  const origenExacto = etapaPorClave(etapasActuales, etapaNueva.clave)

  if (etapaNueva.clave === 'promesa_enganche') {
    const origen = origenExacto || primeraEtapa(etapasActuales, ['cambios', 'revision', 'contrato', 'datos_comprador', 'apartado'])
    const status = origenExacto
      ? normalizarStatus(origenExacto.status)
      : estadoDesdeEtapas(etapasActuales, ['apartado', 'datos_comprador', 'contrato', 'revision', 'cambios'])
    return datosBase(etapaNueva, origen, status)
  }

  if (etapaNueva.clave === 'coordinacion_entrega') {
    return datosBase(etapaNueva, null, 'pendiente')
  }

  if (origenExacto) return datosBase(etapaNueva, origenExacto, normalizarStatus(origenExacto.status))

  return datosBase(etapaNueva, null, etapaNueva.status || 'pendiente')
}

function requiereMigracion(firma, etapasActuales) {
  const claves = etapasActuales.map(etapa => etapa.clave)
  const legacy = LEGACY_CLAVES[firma.tipo] || []
  if (legacy.some(clave => claves.includes(clave))) return true

  const nuevas = getEtapas(firma.tipo, firma.es_contado || false).map(etapa => etapa.clave)
  return nuevas.some(clave => !claves.includes(clave))
}

function reconstruirEtapas(firma, etapasActuales) {
  const nuevas = getEtapas(firma.tipo, firma.es_contado || false)
  return nuevas.map(etapaNueva => {
    const etapa = firma.tipo === 'arrendamiento'
      ? mapearEtapaArrendamiento(etapaNueva, etapasActuales)
      : mapearEtapaCompraventa(etapaNueva, etapasActuales)

    return {
      firma_id: firma.id,
      ...etapa,
    }
  })
}

function etapaActual(etapas) {
  const pendiente = etapas
    .filter(etapa => !['completada', 'no_aplica'].includes(etapa.status))
    .sort((a, b) => a.orden - b.orden)[0]
  return pendiente?.orden || etapas[etapas.length - 1]?.orden || 1
}

function resumenFirma(firma, etapasActuales, etapasNuevas) {
  return {
    id: firma.id,
    titulo: firma.titulo,
    tipo: firma.tipo,
    etapas_antes: etapasActuales.length,
    etapas_despues: etapasNuevas.length,
    etapa_actual_nueva: etapaActual(etapasNuevas),
    claves_antes: etapasActuales.map(etapa => etapa.clave),
    claves_despues: etapasNuevas.map(etapa => etapa.clave),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const auth = await autenticar(req)
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error })

  const { dryRun = false } = req.body || {}

  const { data: firmas, error } = await supabase
    .from('firmas')
    .select('id, titulo, tipo, es_contado, etapa_actual, status, firma_etapas(*)')
    .eq('status', 'activo')
    .in('tipo', ['arrendamiento', 'compraventa'])
    .order('created_at', { ascending: true })

  if (error) return res.status(500).json({ ok: false, error: error.message })

  const candidatas = (firmas || [])
    .map(firma => {
      const etapasActuales = [...(firma.firma_etapas || [])].sort((a, b) => a.orden - b.orden)
      const migrar = requiereMigracion(firma, etapasActuales)
      const etapasNuevas = migrar ? reconstruirEtapas(firma, etapasActuales) : []
      return { firma, etapasActuales, etapasNuevas, migrar }
    })
    .filter(item => item.migrar)

  const resumen = candidatas.map(item => resumenFirma(item.firma, item.etapasActuales, item.etapasNuevas))

  if (dryRun) {
    return res.status(200).json({
      ok: true,
      dryRun: true,
      total_activas: firmas?.length || 0,
      total_por_migrar: candidatas.length,
      resumen,
    })
  }

  const resultados = []

  for (const item of candidatas) {
    const { firma, etapasActuales, etapasNuevas } = item
    const snapshot = etapasActuales.map(etapa => ({
      orden: etapa.orden,
      clave: etapa.clave,
      nombre: etapa.nombre,
      responsable: etapa.responsable,
      status: etapa.status,
      completada_at: etapa.completada_at || null,
      notas: etapa.notas || null,
    }))

    await supabase.from('firma_comentarios').insert({
      firma_id: firma.id,
      usuario_id: auth.user.id,
      usuario_nombre: auth.perfil.full_name || auth.perfil.email || auth.user.email || 'Sistema',
      mensaje: `Respaldo antes de migrar al flujo operativo nuevo: ${JSON.stringify(snapshot)}`,
      tipo: 'comentario',
    })

    const { error: insertError } = await supabase.from('firma_etapas').insert(etapasNuevas)
    if (insertError) {
      resultados.push({ id: firma.id, ok: false, error: insertError.message })
      continue
    }

    const idsAnteriores = etapasActuales.map(etapa => etapa.id).filter(Boolean)
    if (idsAnteriores.length > 0) {
      const { error: deleteError } = await supabase
        .from('firma_etapas')
        .delete()
        .in('id', idsAnteriores)

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
      mensaje: `Expediente actualizado al flujo operativo nuevo. Nueva etapa actual: ${nuevaEtapaActual}.`,
      tipo: 'cambio_etapa',
    })

    resultados.push({ id: firma.id, ok: true, etapa_actual: nuevaEtapaActual })
  }

  return res.status(200).json({
    ok: true,
    dryRun: false,
    total_activas: firmas?.length || 0,
    total_migradas: resultados.filter(r => r.ok).length,
    total_errores: resultados.filter(r => !r.ok).length,
    resumen,
    resultados,
  })
}
