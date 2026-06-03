export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    tipo_ingresos,
    ingresos_mensuales,
    ingresos_empresa,
    monto_renta,
    nombre_completo,
    razon_social,
    file_ingresos,
    file_ingresos_2,
    file_ingresos_3,
    doc_comprobante_ingresos_b64,
    doc_comprobante_ingresos_b64_2,
    doc_comprobante_ingresos_b64_3,
  } = req.body;

  const nombre = nombre_completo || razon_social || 'Solicitante';
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
  const urlsIngresos = [file_ingresos, file_ingresos_2, file_ingresos_3].filter(Boolean);
  const tieneArchivo = urlsIngresos.length > 0;

  const promptAnalisis = (esIdentificacion = false) => `Eres un analista de crédito inmobiliario en México. El solicitante se llama: "${nombre}".

Analiza este documento y responde SOLO en formato JSON:
{
  "nombre_en_documentos": "nombre completo tal como aparece en el documento",
  "nombre_coincide": true|false (true si "${nombre}" coincide razonablemente con el nombre en el documento),
  "tipo_documento": "nomina_quincenal|nomina_mensual|estado_cuenta|declaracion_fiscal|otro",
  "ingreso_mensual": número (ingreso mensual NETO en pesos mexicanos. Para estado de cuenta: suma SOLO depósitos de origen identificable, NO retiros ni transferencias salientes. Para nómina: monto neto del período. Para declaración: ingreso total dividido entre meses),
  "periodo": "ej: enero 2026",
  "empleador_o_actividad": "nombre del empleador o actividad",
  "origen_ingresos": "descripción del origen",
  "ingresos_efectivo_pct": número 0-100,
  "actividad_licita": true|false,
  "alertas": [],
  "confianza": "alta|media|baja"
}
REGLAS CRÍTICAS:
1. Si el nombre no coincide con "${nombre}" → nombre_coincide=false, actividad_licita=false, agrega alerta.
2. Si >30% efectivo sin concepto → actividad_licita=false, agrega alerta.
3. VIGENCIA: El documento debe ser de los últimos 4 meses (fecha actual: ${new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}). Si el documento tiene más de 4 meses de antigüedad → agrega alerta "Documento vencido — debe ser de los últimos 3 meses", marca confianza=baja y actividad_licita=false.
4. NO uses ingresos declarados, solo lo que ves en el documento.
5. Si no puedes leer el monto → null.
No incluyas texto fuera del JSON.`;

  const analizarDocumento = async (url) => {
    const fileRes = await fetch(url);
    if (!fileRes.ok) return null;
    const contentType = fileRes.headers.get('content-type') || 'image/jpeg';
    const buffer = await fileRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mediaType = contentType.includes('pdf') ? 'application/pdf' :
                      contentType.includes('png') ? 'image/png' : 'image/jpeg';

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
      // Analizar cada documento por separado
      const resultados = await Promise.all(urlsIngresos.map(url => analizarDocumento(url).catch(() => null)));
      const validos = resultados.filter(Boolean);

      if (validos.length > 0) {
        // Promediar ingresos de los documentos válidos
        const ingresos = validos.map(r => r.ingreso_mensual).filter(v => v && v > 0);
        const promedioIngreso = ingresos.length > 0 ? ingresos.reduce((a, b) => a + b, 0) / ingresos.length : null;

        // Consolidar alertas y verificaciones
        const todasAlertas = [...new Set(validos.flatMap(r => r.alertas || []))];
        const nombresNoCoinciden = validos.some(r => r.nombre_coincide === false);
        const actividadNoLicita = validos.some(r => r.actividad_licita === false);

        analisisIA = {
          ...validos[0],
          ingreso_mensual: promedioIngreso,
          nombre_coincide: !nombresNoCoinciden,
          actividad_licita: !actividadNoLicita,
          alertas: todasAlertas,
          meses_analizados: validos.length,
          documentos_analizados: validos.length,
          ingresos_por_mes: ingresos,
        };

        ingresoDetectado = promedioIngreso;
        tipoDocumento = validos[0].tipo_documento;
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
    resultado = 'pendiente';
    color = '#92400e';
    icono = '⏳';
    mensaje = 'No se pudo determinar el ingreso automáticamente. Nuestro equipo lo revisará manualmente.';
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
    mensaje,           // Mensaje amable para el inquilino
    mensajeInterno,    // Detalle técnico solo para la abogada
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
