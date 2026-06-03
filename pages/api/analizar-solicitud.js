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

  // Ingreso declarado por el solicitante
  const ingresoDeclado = parseFloat(ingresos_mensuales || ingresos_empresa || 0);

  let analisisIA = null;
  let ingresoDetectado = null;
  let tipoDocumento = null;
  let errorIA = null;

  // ── Analizar documentos con Claude (hasta 3 archivos) ──
  const docsB64 = [doc_comprobante_ingresos_b64, doc_comprobante_ingresos_b64_2, doc_comprobante_ingresos_b64_3].filter(Boolean);
  const urlsIngresos = [file_ingresos, file_ingresos_2, file_ingresos_3].filter(Boolean);
  const tieneArchivo = urlsIngresos.length > 0 || docsB64.length > 0;

  if (tieneArchivo) {
    try {
      const parseB64 = (b64str) => {
        const match = b64str.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return null;
        let mediaType = match[1];
        if (mediaType.includes('pdf')) mediaType = 'application/pdf';
        else if (mediaType.includes('png')) mediaType = 'image/png';
        else mediaType = 'image/jpeg';
        return { base64: match[2], mediaType };
      };

      let contentBlocks = [];

      // Procesar URLs (nuevo flujo — hasta 3 archivos desde Storage)
      const urlsToProcess = urlsIngresos.length > 0 ? urlsIngresos : [];
      for (const url of urlsToProcess) {
        const fileRes = await fetch(url);
        if (!fileRes.ok) continue;
        const contentType = fileRes.headers.get('content-type') || 'image/jpeg';
        const buffer = await fileRes.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const mediaType = contentType.includes('pdf') ? 'application/pdf' :
                          contentType.includes('png') ? 'image/png' : 'image/jpeg';
        contentBlocks.push({
          type: mediaType === 'application/pdf' ? 'document' : 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        });
      }

      // Procesar base64 (flujo legacy)
      if (contentBlocks.length === 0 && docsB64.length > 0) {
        for (const b64str of docsB64) {
          const parsed = parseB64(b64str);
          if (!parsed) continue;
          contentBlocks.push({
            type: parsed.mediaType === 'application/pdf' ? 'document' : 'image',
            source: { type: 'base64', media_type: parsed.mediaType, data: parsed.base64 },
          });
        }
      }

      // Llamar a Claude API con todos los documentos
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
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: [
              ...contentBlocks,
              {
                type: 'text',
                text: `Eres un analista de crédito inmobiliario en México. Analiza este comprobante de ingresos y responde SOLO en formato JSON:
{
  "tipo_documento": "nomina_quincenal|nomina_mensual|estado_cuenta|declaracion_fiscal|otro",
  "ingreso_mensual": número (ingreso mensual NETO promedio en pesos mexicanos. Reglas: nómina quincenal=suma las 2 quincenas de cada mes y promedia; nómina mensual=promedia los meses; estado de cuenta=promedia SOLO los depósitos de origen lícito y verificable de los 3 meses; declaración fiscal=divide ingreso total entre meses que cubre),
  "meses_analizados": número,
  "periodo": "ej: enero-marzo 2026",
  "empleador_o_actividad": "nombre del empleador o actividad económica",
  "origen_ingresos": "descripcion breve del origen, ej: nómina empresa X, honorarios, ventas, etc.",
  "alertas": ["lista de alertas si las hay, por ejemplo: 'Ingresos principalmente en efectivo', 'Depósitos sin concepto identificable', 'Ingresos irregulares o inconsistentes', 'Origen de recursos no verificable'"],
  "ingresos_efectivo_pct": número entre 0 y 100 (porcentaje estimado de depósitos en efectivo vs transferencias/nómina),
  "actividad_licita": true|false (true si los ingresos claramente provienen de actividad laboral o comercial formal, false si son principalmente efectivo sin concepto o depósitos no identificados),
  "confianza": "alta|media|baja"
}
IMPORTANTE: Para inmobiliaria, los ingresos en efectivo sin concepto claro NO son aceptables. Si detectas que más del 30% de los ingresos son depósitos en efectivo sin concepto identificable, marca actividad_licita como false y agrégalo a alertas.
Si no puedes determinar el ingreso, pon null en ingreso_mensual.
No incluyas texto fuera del JSON.`,
              },
            ],
          }],
        }),
      });

      if (!claudeRes.ok) {
        const err = await claudeRes.text();
        throw new Error('Error Claude API: ' + err);
      }

      const claudeData = await claudeRes.json();
      const texto = claudeData.content?.[0]?.text || '';

      // Parsear JSON de la respuesta
      const jsonMatch = texto.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        ingresoDetectado = parsed.ingreso_mensual;
        tipoDocumento = parsed.tipo_documento;
        analisisIA = parsed;
      }
    } catch (e) {
      errorIA = e.message;
      console.error('Error análisis IA:', e.message);
    }
  }

  // ── Determinar pre-viabilidad ──
  // Usar ingreso detectado por IA si está disponible, si no usar el declarado
  const ingresoEvaluar = ingresoDetectado || ingresoDeclado;
  const razonIngreso = ingresoEvaluar > 0 ? (ingresoEvaluar / renta).toFixed(2) : null;

  const actividadLicita = analisisIA?.actividad_licita !== false; // default true si no hay IA
  const alertas = analisisIA?.alertas || [];
  const efectivoPct = analisisIA?.ingresos_efectivo_pct || 0;

  let resultado, color, icono, mensaje;

  if (!ingresoEvaluar || ingresoEvaluar === 0) {
    resultado = 'pendiente';
    color = '#92400e';
    icono = '⏳';
    mensaje = 'No se pudo determinar el ingreso automáticamente. Nuestro equipo lo revisará manualmente.';
  } else if (!actividadLicita) {
    resultado = 'no_viable';
    color = '#991b1b';
    icono = '❌';
    mensaje = `No se puede verificar el origen lícito de los ingresos. ${alertas.join('. ')}.`;
  } else if (ingresoEvaluar >= ingresoRequerido) {
    resultado = alertas.length > 0 ? 'revisar' : 'viable';
    color = alertas.length > 0 ? '#92400e' : '#065f46';
    icono = alertas.length > 0 ? '⚠️' : '✅';
    mensaje = alertas.length > 0
      ? `Tus ingresos califican en monto (${razonIngreso}x), pero hay puntos a revisar: ${alertas.join('. ')}.`
      : `Tus ingresos califican para esta renta. Relación ingreso/renta: ${razonIngreso}x (mínimo requerido: ${multiplicador}x).`;
  } else if (ingresoEvaluar >= ingresoRequerido * 0.85) {
    resultado = 'revisar';
    color = '#92400e';
    icono = '⚠️';
    mensaje = `Tus ingresos están cerca del mínimo requerido. Relación: ${razonIngreso}x (mínimo: ${multiplicador}x). Tu expediente será revisado manualmente.`;
  } else {
    resultado = 'no_viable';
    color = '#991b1b';
    icono = '❌';
    mensaje = `Tus ingresos no alcanzan el mínimo requerido para esta renta. Relación: ${razonIngreso}x (mínimo: ${multiplicador}x).`;
  }

  return res.status(200).json({
    resultado,
    icono,
    color,
    mensaje,
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
