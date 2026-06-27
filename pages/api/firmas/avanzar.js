import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

const CORREOS_NOTIFICACION = [
  'carlos.nachon@emporioinmobiliario.mx',
  'administracion@emporioinmobiliario.com.mx',
  'guillermo@emporioinmobiliario.com.mx',
  'juridico@emporioinmobiliario.mx',
]
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { firma_id, etapa_id, notas, usuario_id, usuario_nombre } = req.body

  const { data: etapa } = await supabase
    .from('firma_etapas')
    .update({ status: 'completada', notas, completada_por: usuario_id, completada_at: new Date() })
    .eq('id', etapa_id)
    .select()
    .single()

  const { data: siguientes } = await supabase
    .from('firma_etapas')
    .select('*')
    .eq('firma_id', firma_id)
    .eq('status', 'pendiente')
    .order('orden', { ascending: true })
    .limit(1)

  let siguiente = siguientes?.[0] || null
  let etapaAutomaticaCerrada = null

  if (siguiente?.clave === 'expediente_concluido') {
    const { data: etapaCerrada } = await supabase
      .from('firma_etapas')
      .update({
        status: 'completada',
        notas: 'Cierre automático al completar la etapa operativa final.',
        completada_por: usuario_id || null,
        completada_at: new Date()
      })
      .eq('id', siguiente.id)
      .select()
      .single()

    etapaAutomaticaCerrada = etapaCerrada
    siguiente = null
  }

  if (siguiente) {
    await supabase.from('firmas').update({ etapa_actual: siguiente.orden }).eq('id', firma_id)
  } else {
    await supabase.from('firmas').update({ status: 'completado' }).eq('id', firma_id)
  }

  await supabase.from('firma_comentarios').insert({
    firma_id,
    usuario_nombre,
    mensaje: `Etapa completada: "${etapa.nombre}". ${notas ? 'Nota: ' + notas : ''}`,
    tipo: 'cambio_etapa'
  })

  if (etapaAutomaticaCerrada) {
    await supabase.from('firma_comentarios').insert({
      firma_id,
      usuario_nombre: 'Sistema',
      mensaje: `Etapa completada automáticamente: "${etapaAutomaticaCerrada.nombre}".`,
      tipo: 'cambio_etapa'
    })
  }

  const { data: firma } = await supabase
    .from('firmas')
    .select('titulo, tipo, propiedad_id, recibo_id')
    .eq('id', firma_id)
    .single()

  const statusFinal = !siguiente
    ? firma?.tipo === 'arrendamiento'
      ? 'leased'
      : firma?.tipo === 'compraventa'
        ? 'sold'
        : null
    : null

  if (etapa?.clave === 'solicitud_poliza' && firma?.tipo === 'arrendamiento' && firma?.recibo_id) {
    await supabase.from('recibos_apartado').update({
      estatus: 'solicitud_recibida',
      solicitud_recibida_en: new Date().toISOString(),
      solicitud_recibida_por: usuario_nombre || null,
    }).eq('id', firma.recibo_id)
    await supabase.from('recibos_log').insert({
      recibo_id: firma.recibo_id,
      accion: 'solicitud_recibida_desde_firmas',
      usuario_id: usuario_id || null,
    })
  }

  if (statusFinal && firma?.propiedad_id) {
    await supabase.from('propiedades').update({
      status: statusFinal,
      status_motivo: statusFinal === 'leased'
        ? 'Expediente de arrendamiento completado en Firmas'
        : 'Expediente de compraventa completado en Firmas',
      status_actualizado_en: new Date().toISOString(),
      status_actualizado_por: usuario_id || null,
    }).eq('id', firma.propiedad_id)
  }

  const reciboConcretado = firma?.tipo === 'arrendamiento'
    ? etapa?.clave === 'firma_pagos'
    : firma?.tipo === 'compraventa'
      ? etapa?.clave === 'promesa_enganche'
      : false

  if (reciboConcretado && firma?.recibo_id) {
    await supabase.from('recibos_apartado')
      .update({ estatus: 'concretado' })
      .eq('id', firma.recibo_id)
    await supabase.from('recibos_log').insert({
      recibo_id: firma.recibo_id,
      accion: firma.tipo === 'arrendamiento'
        ? 'arrendamiento_firmado_en_firmas'
        : 'promesa_compraventa_firmada',
      usuario_id: usuario_id || null,
    })
  }

  const destinatarios = CORREOS_NOTIFICACION
  try {
    await resend.emails.send({
      from: 'cobros@emporioinmobiliario.com.mx',
      to: destinatarios,
      subject: `[Emporio] Avance en expediente: ${firma?.titulo}`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto"><div style="background:#1a3c5e;padding:20px;border-radius:8px 8px 0 0"><h2 style="color:#fff;margin:0;font-size:16px">Actualizacion de expediente</h2></div><div style="background:#f9f9f9;padding:20px;border-radius:0 0 8px 8px;border:1px solid #eee"><p style="margin:0 0 8px"><strong>Expediente:</strong> ${firma?.titulo}</p><p style="margin:0 0 8px"><strong>Etapa completada:</strong> ${etapa.nombre}</p><p style="margin:0 0 8px"><strong>Completada por:</strong> ${usuario_nombre}</p>${siguiente ? `<p style="margin:0 0 8px"><strong>Siguiente paso:</strong> ${siguiente.nombre}</p>` : `<p style="color:#22c55e">Expediente completado.</p>`}${notas ? `<p style="color:#666">Nota: ${notas}</p>` : ''}</div></div>`
    })
  } catch (e) {
    console.error('Error enviando correo:', e)
  }

  return res.status(200).json({ ok: true, siguiente })
}
