import { createClient } from '@supabase/supabase-js';
import pdfParse from 'pdf-parse';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
  maxDuration: 60,
};

// Extraer texto de PDF base64
const extraerTextoPDF = async (b64) => {
  try {
    const match = b64.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const buffer = Buffer.from(match[2], 'base64');
    const data = await pdfParse(buffer);
    return data.text || null;
  } catch (e) {
    console.error('Error extrayendo texto PDF:', e.message);
    return null;
  }
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
  const ingresoDeclado = 0;

  let analisisIA = null;
  let ingresoDetectado = null;
  let tipoDocumento = null;
  let errorIA = null;

  const docsB64 = [doc_comprobante_ingresos_b64, doc_comprobante_ingresos_b64_2_param, doc_comprobante_ingresos_b64_3_param].filter(Boolean);
  const tieneArchivo = docsB64.length > 0;

  // Límite: si base64 pesa más de 500KB, usar extracción de texto
  const LIMITE_B64 = 500 * 1024;

  const promptAnalisisTexto = (texto) => {
    const contextoNegocio = esNegocioPropio
      ? `CONTEXTO IMPORTANTE: El solicitante declaró tipo de ingresos "${tipo_ingresos}". Es dueño o socio de su propio negocio.
- Los depósitos etiquetados como "Prestamo", "Prest" o similares provenientes de su propia empresa SON ingresos legítimos (retiros del dueño).
- Inclúyelos en ingreso_mensual_total e ingreso_mensual_verificable si el nombre de la empresa es consistente.
- NO penalices este patrón — es la operación normal de un empresario que se paga desde su propia empresa.
- Solo marca actividad_licita=false si hay efectivo sin concepto >50% o el nombre no coincide.`
      : `CONTEXTO: El solicitante es empleado. Los préstamos de empresas relacionadas NO cuentan como ingreso verificable.`;

    return `Eres un analista de crédito inmobiliario en México. El solicitante se llama: "${nombre}".
Fecha actual: ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}.

${contextoNegocio}

Analiza el siguiente texto extraído de un estado de cuenta bancario y responde SOLO en formato JSON:
{
  "nombre_en_documentos": "nombre completo tal como aparece en el documento",
  "nombre_coincide": true|false,
  "tipo_documento": "estado_cuenta",
  "ingreso_mensual_total": número o null (suma TODOS los abonos/depósitos del mes),
  "ingreso_mensual_verificable": número o null (para empresario: igual que total. Para empleado: solo origen laboral claro),
  "periodo": "ej: marzo 2026",
  "empleador_o_actividad": "nombre del empleador o empresa propia",
  "origen_ingresos": "descripción detallada de los depósitos",
  "tiene_elementos_autenticidad": true,
  "elementos_autenticidad_detalle": "Estado de cuenta bancario oficial con CFDI y cadena digital SAT",
  "ingresos_efectivo_pct": número 0-100,
  "prestamos_internos_pct": número 0-100 (para empresario con empresa propia: 0),
  "actividad_licita": true|false,
  "alertas": ["observaciones importantes con montos y conceptos"],
  "resumen_analista": "párrafo breve con lo relevante para el analista",
  "confianza": "alta|media|baja"
}

REGLAS:
1. SIEMPRE calcula ingreso_mensual_total sumando todos los ABONOS del periodo.
2. Para calcular ingreso: usa la columna ABONOS del detalle de movimientos, NO el saldo promedio.
3. NOMBRE: Si no coincide → nombre_coincide=false.
4. VIGENCIA: Si tiene más de 4 meses → alerta "Documento vencido".
5. No incluyas texto fuera del JSON.

TEXTO DEL ESTADO DE CUENTA:
${texto.substring(0, 15000)}`;
  };

  const promptAnalisisDoc = (mediaType) => {
    const contextoNegocio = esNegocioPropio
      ? `CONTEXTO IMPORTANTE: El solicitante declaró tipo de ingresos "${tipo_ingresos}". Es dueño o socio de su propio negocio.
- Los depósitos etiquetados como "Prestamo", "Prest" o similares provenientes de su propia empresa SON ingresos legítimos.
- Inclúyelos en ingreso_mensual_total e ingreso_mensual_verificable.
- NO penalices este patrón.`
      : `CONTEXTO: El solicitante es empleado. Los préstamos internos NO cuentan como ingreso verificable.`;

    return `Eres un analista de crédito inmobiliario en México. El solicitante se llama: "${nombre}".
Fecha actual: ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}.

${contextoNegocio}

Analiza este documento y responde SOLO en formato JSON:
{
  "nombre_en_documentos": "nombre completo tal como aparece en el documento",
  "nombre_coincide": true|false,
  "tipo_documento": "ine|nomina_quincenal|nomina_mensual|estado_cuenta|declaracion_fiscal|constancia_fiscal|carta_laboral|otro",
  "ingreso_mensual_total": número o null,
  "ingreso_mensual_verificable": número o null,
  "periodo": "ej: marzo 2026",
  "empleador_o_actividad": "nombre del empleador o empresa propia",
  "origen_ingresos": "descripción detallada",
  "tiene_elementos_autenticidad": true|false,
  "elementos_autenticidad_detalle": "descripción",
  "ingresos_efectivo_pct": número 0-100,
  "prestamos_internos_pct": número 0-100,
  "actividad_licita": true|false,
  "alertas": ["observaciones"],
  "resumen_analista": "párrafo breve",
  "confianza": "alta|media|baja"
}

REGLAS:
1. SIEMPRE calcula ingreso_mensual_total.
2. NOMBRE: Si no coincide → nombre_coincide=false.
3. VIGENCIA: Si tiene más de 4 meses → alerta "Documento vencido".
4. No incluyas texto fuera del JSON.`;
  };

  const analizarDocumento = async (input) => {
    const match = input.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;

    const mediaType = match[1].includes('pdf') ? 'application/pdf' : match[1].includes('png') ? 'image/png' : 'image/jpeg';
    const b64Size = match[2].length;

    // Si es PDF grande, extraer texto y mandar como texto plano
    if (mediaType === 'application/pdf' && b64Size > LIMITE_B64) {
      console.log(`PDF grande (${Math.round(b64Size/1024)}KB), extrayendo texto...`);
      const texto = await extraerTextoPDF(input);
      if (!texto) return null;

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [{ type: 'text', text: promptAnalisisTexto(texto) }],
          }],
        }),
      });

      if (!claudeRes.ok) throw new Error('Error Claude API: ' + await claudeRes.text());
      const data = await claudeRes.json();
      const texto_resp = data.content?.[0]?.text || '';
      const jsonMatch = texto_resp.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    }

    // PDF pequeño o imagen: mandar como documento/imagen normal
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: mediaType === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: mediaType, data: match[2] } },
            { type: 'text', text: promptAnalisisDoc(mediaType) },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) throw new Error('Error Claude API: ' + await claudeRes.text());
    const data = await claudeRes.json();
    const texto_resp = data.content?.[0]?.text || '';
    const jsonMatch = texto_resp.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  };

  if (tieneArchivo) {
    try {
      const resultados = await Promise.all(docsB64.map(input => analizarDocumento(input).catch(() => null)));
      const validos = resultados.filter(Boolean);

      if (validos.length > 0) {
        const docINE = validos.find(r => r.tipo_documento === 'ine');
        const docsIngresos = validos.filter(r => r.tipo_documento !== 'ine');

        const ingresosVerificables = docsIngresos.map(r => r.ingreso_mensual_verificable || r.ingreso_mensual).filter(v => v && v > 0);
        const ingresosTotales = docsIngresos.map(r => r.ingreso_mensual_total || r.ingreso_mensual).filter(v => v && v > 0);
        const promedioIngreso = ingresosVerificables.length > 0 ? ingresosVerificables.reduce((a, b) => a + b, 0) / ingresosVerificables.length : null;
        const promedioTotal = ingresosTotales.length > 0 ? ingresosTotales.reduce((a, b) => a + b, 0) / ingresosTotales.length : null;

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

        const sinAutenticidad = validos.filter(r => r.tiene_elementos_autenticidad === false);
        const alertasAutenticidad = sinAutenticidad.map(r => r.elementos_autenticidad_detalle || 'Documento sin elementos de autenticidad verificables');

        const todasAlertas = [
          ...new Set(validos.flatMap(r => r.alertas || [])),
          ...alertasAutenticidad,
          ...(alertaCruceNombre ? [alertaCruceNombre] : []),
        ].filter(Boolean);

        const nombresNoCoinciden = validos.some(r => r.nombre_coincide === false) || !!alertaCruceNombre;
        const actividadNoLicita = validos.some(r => r.actividad_licita === false);
        const resumenAnalista = docsIngresos.map(r => r.resumen_analista).filter(Boolean).join(' | ');

        analisisIA = {
          ...validos[0],
          ingreso_mensual: promedioIngreso,
          ingreso_mensual_total: promedioTotal,
          nombre_coincide: !nombresNoCoinciden,
          actividad_licita: !actividadNoLicita,
          alertas: todasAlertas,
          meses_analizados: docsIngresos.length,
          documentos_analizados: validos.length,
          ingresos_por_mes: ingresosVerificables,
          tiene_ine: !!docINE,
          nombre_en_ine: docINE?.nombre_en_documentos,
          resumen_analista: resumenAnalista,
        };

        ingresoDetectado = promedioIngreso;
        tipoDocumento = docsIngresos[0]?.tipo_documento || validos[0].tipo_documento;
      }
    } catch (e) {
      errorIA = e.message;
      console.error('Error análisis IA:', e.message);
      if (e.message.includes('100 PDF pages') || e.message.includes('too large') || e.message.includes('page')) {
        analisisIA = {
          nombre_coincide: null,
          actividad_licita: null,
          ingreso_mensual: null,
          alertas: ['Documentos demasiado extensos para análisis automático — revisión manual requerida'],
          confianza: 'baja',
          revision_manual: true,
        };
      }
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

  if (analisisIA?.revision_manual) {
    resultado = 'pendiente'; color = '#92400e'; icono = '⏳';
    mensaje = 'Los documentos requieren revisión manual por nuestro equipo jurídico. Te contactaremos en breve.';
  } else if (!ingresoEvaluar || ingresoEvaluar === 0) {
    if (alertas.length > 0 || !actividadLicita || !nombreCoincide) {
      resultado = 'revisar'; color = '#92400e'; icono = '⚠️';
      mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico revisará tus documentos y te contactará en breve.';
      mensajeInterno = `No se pudo calcular el ingreso, pero se detectaron observaciones: ${alertas.join('. ')}`;
    } else {
      resultado = 'pendiente'; color = '#92400e'; icono = '⏳';
      mensaje = 'No se pudo determinar el ingreso automáticamente. Nuestro equipo lo revisará manualmente.';
      mensajeInterno = analisisIA
        ? `Ingreso total detectado: $${analisisIA.ingreso_mensual_total ? Number(analisisIA.ingreso_mensual_total).toLocaleString('es-MX') : '—'}/mes. Ingreso verificable: $${analisisIA.ingreso_mensual ? Number(analisisIA.ingreso_mensual).toLocaleString('es-MX') : '—'}/mes. ${analisisIA.resumen_analista || ''}`
        : null;
    }
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
      : '¡Buenas noticias! Tus ingresos califican preliminarmente para esta renta. Nuestro equipo confirmará los detalles contigo.';
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

  return res.status(200).json({
    resultado, icono, color, mensaje, mensajeInterno, validacionCurp,
    detalles: { nombre, renta, multiplicador, ingresoRequerido, ingresoDeclado, ingresoDetectado, ingresoEvaluar, razonIngreso, tipoDocumento, analisisIA, errorIA },
  });
}
