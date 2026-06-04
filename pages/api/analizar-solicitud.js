import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { solicitud_id } = req.body;
  if (!solicitud_id) return res.status(400).json({ error: 'solicitud_id requerido' });

  const { data: sol, error: solError } = await supabase
    .from('solicitudes_inquilino')
    .select('nombre_completo, razon_social, tipo_ingresos, ingresos_mensuales, ingresos_empresa, monto_renta_solicitada, doc_comprobante_ingresos_b64, doc_ingresos_b64_2, doc_ingresos_b64_3, curp')
    .eq('id', solicitud_id)
    .single();

  if (solError || !sol) return res.status(404).json({ error: 'Solicitud no encontrada' });

  const tipo_ingresos = sol.tipo_ingresos;
  const monto_renta = sol.monto_renta_solicitada;
  const doc_comprobante_ingresos_b64 = sol.doc_comprobante_ingresos_b64;
  const doc_comprobante_ingresos_b64_2_param = sol.doc_ingresos_b64_2;
  const doc_comprobante_ingresos_b64_3_param = sol.doc_ingresos_b64_3;

  const nombre = sol.nombre_completo || sol.razon_social || 'Solicitante';
  const renta = parseFloat(monto_renta) || 0;

  const esNegocioPropio = ['Negocio propio', 'Actividad empresarial', 'Persona moral'].some(t =>
    (tipo_ingresos || '').includes(t)
  );
  const multiplicador = esNegocioPropio ? 3 : 2.5;
  const ingresoRequerido = renta * multiplicador;
  const ingresoDeclado = parseFloat(sol.ingresos_mensuales || sol.ingresos_empresa || 0);

  let analisisIA = null;
  let ingresoDetectado = null;
  let tipoDocumento = null;
  let errorIA = null;

  const docsB64 = [doc_comprobante_ingresos_b64, doc_comprobante_ingresos_b64_2_param, doc_comprobante_ingresos_b64_3_param].filter(Boolean);
  const tieneArchivo = docsB64.length > 0;

  // Truncar PDFs a ~800KB para no exceder límite de Claude
  const MAX_B64 = 800 * 1024;
  const truncarB64 = (input) => {
    const match = input.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return input;
    const b64 = match[2];
    if (b64.length <= MAX_B64) return input;
    const truncado = b64.substring(0, MAX_B64 - (MAX_B64 % 4));
    return `data:${match[1]};base64,${truncado}`;
  };

  const analizarDocumento = async (input) => {
    const match = input.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return null;

    let mediaType = match[1];
    if (mediaType.includes('pdf')) mediaType = 'application/pdf';
    else if (mediaType.includes('png')) mediaType = 'image/png';
    else mediaType = 'image/jpeg';

    const inputFinal = mediaType === 'application/pdf' ? truncarB64(input) : input;
    const matchFinal = inputFinal.match(/^data:([^;]+);base64,(.+)$/s);
    if (!matchFinal) return null;

    const contextoNegocio = esNegocioPropio
  ? `El solicitante es dueño de negocio (${tipo_ingresos}). Los depósitos de su propia empresa cuentan como ingreso legítimo. NO alertes sobre: saldo promedio bajo, transferencias frecuentes entre cuentas propias, retiros de efectivo operativos, ni depósitos etiquetados como préstamos de su misma empresa. Solo alerta si: el nombre no coincide, hay depósitos de origen completamente desconocido, o hay señales claras de fraude.`
  : `El solicitante es empleado. Los préstamos de empresas relacionadas NO cuentan como ingreso verificable.`;
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            {
              type: mediaType === 'application/pdf' ? 'document' : 'image',
              source: { type: 'base64', media_type: mediaType, data: matchFinal[2] },
            },
            {
              type: 'text',
              text: `Analiza este documento de ingresos. ${contextoNegocio}
El solicitante se llama: "${nombre}".

Responde SOLO en formato JSON:
{
  "tipo_documento": "nomina|estado_cuenta|declaracion_fiscal|ine|otro",
  "nombre_en_documentos": "nombre tal como aparece",
  "nombre_coincide": true|false,
  "ingreso_mensual": número o null (ingreso mensual neto. Para estado de cuenta: suma total de ABONOS del periodo. Para nómina: monto neto. Para declaración fiscal: total anual ÷ 12. Para INE: null),
  "periodo": "ej: marzo 2026",
  "empleador_o_actividad": "nombre del empleador o empresa",
  "tiene_elementos_autenticidad": true|false,
  "alertas": [],
  "confianza": "alta|media|baja"
}
No incluyas texto fuera del JSON.`,
            },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) throw new Error('Error Claude API: ' + await claudeRes.text());
    const data = await claudeRes.json();
    const texto = data.content?.[0]?.text || '';
    const jsonMatch = texto.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  };

  if (tieneArchivo) {
    try {
      const resultados = await Promise.all(docsB64.map(input => analizarDocumento(input).catch(e => {
        console.error('Error doc:', e.message);
        return null;
      })));
      const validos = resultados.filter(Boolean);

      if (validos.length > 0) {
        const docINE = validos.find(r => r.tipo_documento === 'ine');
        const docsIngresos = validos.filter(r => r.tipo_documento !== 'ine');

        const ingresos = docsIngresos.map(r => r.ingreso_mensual).filter(v => v && v > 0);
        const promedioIngreso = ingresos.length > 0 ? ingresos.reduce((a, b) => a + b, 0) / ingresos.length : null;

        let alertaCruceNombre = null;
        if (docINE && docsIngresos.length > 0) {
          const nombreINE = docINE.nombre_en_documentos;
          const nombreEstados = docsIngresos[0].nombre_en_documentos;
          if (nombreINE && nombreEstados) {
            const normalizar = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
            const palabrasINE = normalizar(nombreINE).split(' ').filter(p => p.length > 2);
            const coincideAlMenos2 = palabrasINE.filter(p => normalizar(nombreEstados).includes(p)).length >= 2;
            if (!coincideAlMenos2) {
              alertaCruceNombre = `Nombre en INE (${nombreINE}) no coincide con nombre en estados de cuenta (${nombreEstados})`;
            }
          }
        }

        const todasAlertas = [
          ...new Set(validos.flatMap(r => r.alertas || [])),
          ...(alertaCruceNombre ? [alertaCruceNombre] : []),
        ].filter(Boolean);

        const nombresNoCoinciden = validos.some(r => r.nombre_coincide === false) || !!alertaCruceNombre;
        const actividadNoLicita = validos.some(r => r.actividad_licita === false);

        analisisIA = {
          ...validos[0],
          ingreso_mensual: promedioIngreso,
          nombre_coincide: !nombresNoCoinciden,
          actividad_licita: !actividadNoLicita,
          alertas: todasAlertas,
          meses_analizados: docsIngresos.length,
          documentos_analizados: validos.length,
          ingresos_por_mes: ingresos,
          tiene_ine: !!docINE,
          nombre_en_ine: docINE?.nombre_en_documentos,
        };

        ingresoDetectado = promedioIngreso;
        tipoDocumento = docsIngresos[0]?.tipo_documento || validos[0].tipo_documento;
      }
    } catch (e) {
      errorIA = e.message;
      console.error('Error análisis IA:', e.message);
    }
  }

  // ── Validación CURP ──
  let validacionCurp = null;
  if (sol.curp) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.emporioinmobiliario.com.mx';
      const curpRes = await fetch(`${baseUrl}/api/validar-curp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curp: sol.curp, nombre_completo: nombre }),
      });
      if (curpRes.ok) validacionCurp = await curpRes.json();
    } catch (e) {
      console.error('Error validando CURP:', e.message);
    }
  }

  if (validacionCurp) {
    if (!analisisIA) analisisIA = { alertas: [] };
    if (!analisisIA.alertas) analisisIA.alertas = [];
    if (validacionCurp.alertas?.length > 0) analisisIA.alertas = [...analisisIA.alertas, ...validacionCurp.alertas];
    if (validacionCurp.resultado === 'no_match') analisisIA.actividad_licita = false;
    if (validacionCurp.resultado === 'curp_baja') analisisIA.actividad_licita = false;
    analisisIA.curp_validada = validacionCurp.valido;
    analisisIA.nombre_en_renapo = validacionCurp.nombre_en_renapo;
    analisisIA.curp_status = validacionCurp.curp_status;
  }

  // ── Pre-viabilidad ──
  const ingresoEvaluar = ingresoDetectado || ingresoDeclado;
  const razonIngreso = ingresoEvaluar > 0 ? (ingresoEvaluar / renta).toFixed(2) : null;
  const actividadLicita = analisisIA?.actividad_licita !== false;
  const nombreCoincide = analisisIA?.nombre_coincide !== false;
  const alertas = analisisIA?.alertas || [];

  let resultado, color, icono, mensaje, mensajeInterno = null;

  if (!ingresoEvaluar || ingresoEvaluar === 0) {
    resultado = 'pendiente'; color = '#92400e'; icono = '⏳';
    mensaje = 'No se pudo determinar el ingreso automáticamente. Nuestro equipo lo revisará manualmente.';
    mensajeInterno = analisisIA
      ? `Ingreso detectado: $${analisisIA.ingreso_mensual ? Number(analisisIA.ingreso_mensual).toLocaleString('es-MX') : '—'}/mes. ${analisisIA.alertas?.join('. ') || ''}`
      : null;
  } else if (!nombreCoincide) {
    resultado = 'revisar'; color = '#92400e'; icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico revisará tus documentos y te contactará en breve.';
    mensajeInterno = `Alerta: El nombre en documentos (${analisisIA?.nombre_en_documentos || '—'}) no coincide con el solicitante.`;
  } else if (!actividadLicita) {
    resultado = 'revisar'; color = '#92400e'; icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico revisará tus documentos y te contactará en breve.';
    mensajeInterno = `Alerta: ${alertas.join('. ')}.`;
  } else if (ingresoEvaluar >= ingresoRequerido) {
    resultado = alertas.length > 0 ? 'revisar' : 'viable';
    color = alertas.length > 0 ? '#92400e' : '#065f46';
    icono = alertas.length > 0 ? '⚠️' : '✅';
    mensaje = alertas.length > 0
      ? 'Tus documentos han sido recibidos. Nuestro equipo los revisará y te contactará en breve.'
      : '¡Buenas noticias! Tus ingresos califican preliminarmente para esta renta.';
    mensajeInterno = alertas.length > 0 ? `Ingresos suficientes pero con alertas: ${alertas.join('. ')}` : null;
  } else if (ingresoEvaluar >= ingresoRequerido * 0.85) {
    resultado = 'revisar'; color = '#92400e'; icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico la revisará y te contactará en breve.';
    mensajeInterno = `Ingresos cerca del límite: relación ${razonIngreso}x (mínimo ${multiplicador}x).`;
  } else {
    resultado = 'revisar'; color = '#92400e'; icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico la revisará y te contactará en breve.';
    mensajeInterno = `Ingresos insuficientes: relación ${razonIngreso}x (mínimo ${multiplicador}x).`;
  }

  // ── Guardar resultados en Supabase ──
  await supabase.from('solicitudes_inquilino').update({
    pre_viabilidad: resultado,
    pre_viabilidad_detalle: mensaje,
    pre_viabilidad_detalle_interno: mensajeInterno,
    ingreso_detectado_ia: ingresoDetectado,
    curp_validada: validacionCurp?.valido ?? null,
    curp_nombre_renapo: validacionCurp?.nombre_en_renapo || null,
  }).eq('id', solicitud_id);

  return res.status(200).json({
    resultado, icono, color, mensaje, mensajeInterno, validacionCurp,
    detalles: { nombre, renta, multiplicador, ingresoRequerido, ingresoDeclado, ingresoDetectado, ingresoEvaluar, razonIngreso, tipoDocumento, analisisIA, errorIA },
  });
}
