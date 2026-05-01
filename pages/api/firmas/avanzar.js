import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

const CORREOS_ROL = {
  ventas:        'ventas@emporioinmobiliario.com.mx',
  juridico:      'juridico@emporioinmobiliario.com.mx',
  administracion:'administracion@emporioinmobiliario.com.mx',
  coordinacion:  'coordinacion@emporioinmobiliario.com.mx',
  direccion:     'ventas@emporioinmobiliario.mx',
}

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

  const siguiente = siguientes?.[0]

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

  const { data: firma } = await supabase
    .from('firmas')
    .select('titulo, tipo')
    .eq('id', firma_id)
    .single()

  const destinatarios = Object.values(CORREOS_ROL)

  await resend.emails.send({
    from: 'cobros@emporioinmobiliario.com.mx',
    to: destinatarios,
    subject: `[Emporio] Avance en expediente: ${firma?.titulo}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
        <div style="background:#1a3c5e;padding:20px;border-radius:8px 8px 0 0">
          <h2 style="color:#fff;margin:0;font-size:16px">Actualizacion de expediente</h2>
        </div>
        <div style="background:#f9f9f9;padding:20px;border-radius:0 0 8px 8px;border:1px solid #eee">
          <p style="margin:0 0 8px"><strong>Expediente:</strong> ${firma?.titulo}</p>
          <p style="margin:0 0 8px"><strong>Etapa completada:</strong> ${etapa.nombre}</p>
          <p style="margin:0 0 8px"><strong>Completada por:</strong> ${usuario_nombre}</p>
          ${siguiente
            ? `<p style="margin:0 0 8px"><strong>Siguiente paso:</strong> ${siguiente.nombre} (${siguiente.responsable})</p>`
            : `<p style="margin:0;color:#22c55e"><strong>Expediente completado.</strong></p>`
          }
          ${notas ? `<p style="margin:8px 0 0;color:#666"><em>Nota: ${notas}</em></p>` : ''}
          <div style="margin-top:20px">
            <a href="https://app.emporioinmobiliario.com.m
