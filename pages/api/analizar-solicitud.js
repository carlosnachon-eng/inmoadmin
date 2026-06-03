import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { solicitud_id } = req.body;
  if (!solicitud_id) return res.status(400).json({ error: 'solicitud_id requerido' });

  // Leer datos de Supabase — archivos ya guardados ahí
  const { data: sol, error: solError } = await supabase
    .from('solicitudes_inquilino')
    .select('nombre_completo, razon_social, tipo_ingresos, ingresos_mensuales, ingresos_empresa, monto_renta_solicitada, doc_comprobante_ingresos_b64, doc_ingresos_b64_2, doc_ingresos_b64_3, curp')
    .eq('id', solicitud_id)
    .single();

  if (solError || !sol) return res.status(404).json({ error: 'Solicitud no encontrada' });

  const tipo_ingresos = sol.tipo_ingresos;
  const ingresos_mensuales = sol.ingresos_mensuales;
  const ingresos_empresa = sol.ingresos_empresa;
  const monto_renta = sol.monto_renta_solicitada;
  const doc_comprobante_ingresos_b64 = sol.doc_comprobante_ingresos_b64;
  const doc_comprobante_ingresos_b64_2_param = sol.doc_ingresos_b64_2;
  const doc_comprobante_ingresos_b64_3_param = sol.doc_ingresos_b64_3;
  const file_ingresos = null;
  const file_ingresos_2 = null;
  const file_ingresos_3 = null;

  const nombre = sol.nombre_completo || sol.razon_social || 'Solicitante';

  const renta = parseFloat(monto_renta) || 0;

  // Determinar multiplicador según tipo de ingresos
  const esNegocioPropio = ['Negocio propio', 'Actividad empresarial', 'Persona moral'].some(t =>
    (tipo_ingresos || '').includes(t)
  );
  const multiplicador = esNegocioPropio ? 3 : 2.5;
  const ingresoRequerido = renta * multiplicador;

  // Ingreso declarado — solo se usa si la IA no puede leer los documentos
  const ingresoDeclado = 0; // Ignoramos el declarado, siempre usamos el detectado por IA

  let analisisIA = null;
  let ingresoDetectado = null;
  let tipoDocumento = null;
  let errorIA = null;

  // ── Analizar documentos con Claude — uno por uno para evitar límite de páginas ──
  const docsB64 = [doc_comprobante_ingresos_b64, doc_comprobante_ingresos_b64_2_param, doc_comprobante_ingresos_b64_3_param].filter(Boolean);
  const urlsIngresos = [file_ingresos, file_ingresos_2, file_ingresos_3].filter(Boolean);
  const tieneArchivo = docsB64.length > 0 || urlsIngresos.length > 0;

  const promptAnalisis = () => `Eres un analista de crédito inmobiliario en México. El solicitante se llama: "${nombre}".
Fecha actual: ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}.

Analiza este documento y responde SOLO en formato JSON:
{
  "nombre_en_documentos": "nombre completo tal como aparece en el documento",
  "nombre_coincide": true|false (compara "${nombre}" con el nombre en el documento — acepta variaciones de acentos/mayúsculas),
  "tipo_documento": "ine|nomina_quincenal|nomina_mensual|estado_cuenta|declaracion_fiscal|constancia_fiscal|carta_laboral|otro",
  "ingreso_mensual": número o null (SOLO para comprobantes de ingresos. REGLAS ESTRICTAS: 1) Suma ÚNICAMENTE depósitos/abonos entrantes de origen laboral o comercial identificable. 2) EXCLUYE: saldo, retiros, cargos, transferencias salientes, préstamos entre empresas relacionadas. 3) Nómina: usa el monto neto. 4) Declaración fiscal: ingreso total ÷ meses. 5) Para INE o carta laboral: null),
  "periodo": "ej: marzo 2026 o enero-marzo 2026",
  "empleador_o_actividad": "nombre del empleador o giro comercial",
  "origen_ingresos": "descripción clara del origen: nómina, honorarios, ventas, etc.",
  "tiene_elementos_autenticidad": true|false (¿el documento tiene QR, código de barras, cadena digital, folio de verificación o sello oficial del banco/SAT/emisor?),
  "elementos_autenticidad_detalle": "descripción de los elementos encontrados o ausentes",
  "ingresos_efectivo_pct": número 0-100 (% de depósitos en efectivo sin concepto claro),
  "actividad_licita": true|false,
  "alertas": ["lista de alertas específicas"],
  "confianza": "alta|media|baja"
}

REGLAS CRÍTICAS:
1. NOMBRE: Si no coincide con "${nombre}" → nombre_coincide=false, alerta "Nombre en documento no coincide con el solicitante: aparece como [nombre encontrado]".
2. EFECTIVO: Si >30% depósitos en efectivo sin concepto → actividad_licita=false, alerta específica.
3. VIGENCIA: Si el documento tiene más de 4 meses de antigüedad → alerta "Documento vencido", confianza=baja, actividad_licita=false.
4. AUTENTICIDAD: Si no tiene QR, cadena digital ni folio verificable → alerta "Documento sin elementos de autenticidad verificables (sin QR ni cadena digital)".
5. PRÉSTAMOS INTERNOS: Si los depósitos principales vienen etiquetados como 'préstamo' de empresa relacionada → no los cuentes como ingreso, agrega alerta.
6. SOLO INGRESOS: Nunca uses el saldo promedio ni los egresos para evaluar. Solo importan los depósitos entrantes de fuente laboral/comercial.
7. NO uses datos declarados por el solicitante, solo lo que ves.
No incluyas texto fuera del JSON.`;

  const analizarDocumento = async (input) => {
    let base64, mediaType;
    if (input.startsWith('data:')) {
      // Es base64
      const match = input.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;
      mediaType = match[1].includes('pdf') ? 'application/pdf' : match[1].includes('png') ? 'image/png' : 'image/jpeg';
      base64 = match[2];
    } else {
      // Es URL
      const fileRes = await fetch(input);
      if (!fileRes.ok) return null;
      const contentType = fileRes.headers.get('content-type') || 'image/jpeg';
      const buffer = await fileRes.arrayBuffer();
      base64 = Buffer.from(buffer).toString('base64');
      mediaType = contentType.includes('pdf') ? 'application/pdf' : contentType.includes('png') ? 'image/png' : 'image/jpeg';
    }

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
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: mediaType === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: promptAnalisis() },
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
      // Usar b64 si están disponibles, si no usar URLs
      const inputs = docsB64.length > 0 ? docsB64 : urlsIngresos;
      // Analizar cada documento por separado
      const resultados = await Promise.all(inputs.map(input => analizarDocumento(input).catch(() => null)));
      const validos = resultados.filter(Boolean);

      if (validos.length > 0) {
        // Separar INE de comprobantes de ingresos
        const docINE = validos.find(r => r.tipo_documento === 'ine');
        const docsIngresos = validos.filter(r => r.tipo_documento !== 'ine');

        // Promediar ingresos solo de comprobantes (no INE)
        const ingresos = docsIngresos.map(r => r.ingreso_mensual).filter(v => v && v > 0);
        const promedioIngreso = ingresos.length > 0 ? ingresos.reduce((a, b) => a + b, 0) / ingresos.length : null;

        // Verificar que el nombre de la INE coincida con los estados de cuenta
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

        // Verificar autenticidad — alertar si algún documento no tiene elementos
        const sinAutenticidad = validos.filter(r => r.tiene_elementos_autenticidad === false);
        const alertasAutenticidad = sinAutenticidad.map(r => r.elementos_autenticidad_detalle || 'Documento sin elementos de autenticidad verificables');

        // Consolidar todas las alertas
        const todasAlertas = [
          ...new Set(validos.flatMap(r => r.alertas || [])),
          ...alertasAutenticidad,
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
      // Si el error es por límite de páginas, marcar para revisión manual
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

  // ── Validación CURP con Didit (en paralelo al análisis de documentos) ──
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

  // ── Agregar alertas de CURP al análisis ──
  if (validacionCurp) {
    if (!analisisIA) analisisIA = { alertas: [] };
    if (!analisisIA.alertas) analisisIA.alertas = [];
    if (validacionCurp.alertas?.length > 0) {
      analisisIA.alertas = [...analisisIA.alertas, ...validacionCurp.alertas];
    }
    if (validacionCurp.resultado === 'no_match') {
      analisisIA.actividad_licita = false;
    }
    if (validacionCurp.resultado === 'curp_baja') {
      analisisIA.actividad_licita = false;
    }
    analisisIA.curp_validada = validacionCurp.valido;
    analisisIA.nombre_en_renapo = validacionCurp.nombre_en_renapo;
    analisisIA.curp_status = validacionCurp.curp_status;
  }

  // ── Determinar pre-viabilidad ──
  // Usar ingreso detectado por IA si está disponible, si no usar el declarado
  const ingresoEvaluar = ingresoDetectado || ingresoDeclado;
  const razonIngreso = ingresoEvaluar > 0 ? (ingresoEvaluar / renta).toFixed(2) : null;

  const actividadLicita = analisisIA?.actividad_licita !== false;
  const nombreCoincide = analisisIA?.nombre_coincide !== false; // default true si no hay IA
  const alertas = analisisIA?.alertas || [];
  const efectivoPct = analisisIA?.ingresos_efectivo_pct || 0;

  let resultado, color, icono, mensaje, mensajeInterno = null;

  if (analisisIA?.revision_manual) {
    resultado = 'pendiente';
    color = '#92400e';
    icono = '⏳';
    mensaje = 'Los documentos requieren revisión manual por nuestro equipo jurídico. Te contactaremos en breve.';
  } else if (!ingresoEvaluar || ingresoEvaluar === 0) {
    // Sin ingreso detectable — pero si hay alertas de la IA, mostrarlas
    if (alertas.length > 0 || !actividadLicita || !nombreCoincide) {
      resultado = 'revisar';
      color = '#92400e';
      icono = '⚠️';
      mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico revisará tus documentos y te contactará en breve.';
      mensajeInterno = `No se pudo calcular el ingreso, pero se detectaron observaciones: ${alertas.join('. ')}`;
    } else {
      resultado = 'pendiente';
      color = '#92400e';
      icono = '⏳';
      mensaje = 'No se pudo determinar el ingreso automáticamente. Nuestro equipo lo revisará manualmente.';
      mensajeInterno = analisisIA ? `Análisis IA corrió pero no detectó ingreso verificable. Tipo doc: ${analisisIA.tipo_documento || '—'}` : null;
    }
  } else if (!nombreCoincide) {
    resultado = 'revisar';
    color = '#92400e';
    icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico revisará tus documentos y te contactará en breve.';
    mensajeInterno = `Alerta: El nombre en documentos (${analisisIA?.nombre_en_documentos || '—'}) no coincide con el solicitante.`;
  } else if (!actividadLicita) {
    resultado = 'revisar';
    color = '#92400e';
    icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico revisará tus documentos y te contactará en breve.';
    mensajeInterno = `Alerta: ${alertas.join('. ')}.`;
  } else if (ingresoEvaluar >= ingresoRequerido) {
    resultado = alertas.length > 0 ? 'revisar' : 'viable';
    color = alertas.length > 0 ? '#92400e' : '#065f46';
    icono = alertas.length > 0 ? '⚠️' : '✅';
    mensaje = alertas.length > 0
      ? 'Tus documentos han sido recibidos. Nuestro equipo los revisará y te contactará en breve.'
      : `¡Buenas noticias! Tus ingresos califican preliminarmente para esta renta. Nuestro equipo confirmará los detalles contigo.`;
    mensajeInterno = alertas.length > 0 ? `Ingresos suficientes pero con alertas: ${alertas.join('. ')}` : null;
  } else if (ingresoEvaluar >= ingresoRequerido * 0.85) {
    resultado = 'revisar';
    color = '#92400e';
    icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico la revisará y te contactará en breve.';
    mensajeInterno = `Ingresos cerca del límite: relación ${razonIngreso}x (mínimo ${multiplicador}x).`;
  } else {
    resultado = 'revisar';
    color = '#92400e';
    icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico la revisará y te contactará en breve.';
    mensajeInterno = `Ingresos insuficientes: relación ${razonIngreso}x (mínimo ${multiplicador}x).`;
  }

  return res.status(200).json({
    resultado,
    icono,
    color,
    mensaje,
    mensajeInterno,
    validacionCurp,    // Resultado de validación CURP en RENAPO
    detalles: {
      nombre,
      renta,
      multiplicador,
      ingresoRequerido,
      ingresoDeclado,
      ingresoDetectado,
      ingresoEvaluar,
      razonIngreso,
      tipoDocumento,
      analisisIA,
      errorIA,
    },
  });
}
