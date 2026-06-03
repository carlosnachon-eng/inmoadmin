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
    doc_comprobante_ingresos_b64, // base64 desde solicitud-inquilino
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

  // ── Analizar documento con Claude si hay archivo ──
  const tieneArchivo = file_ingresos || doc_comprobante_ingresos_b64;
  if (tieneArchivo) {
    try {
      let base64, mediaType;

      if (doc_comprobante_ingresos_b64) {
        // Formato: "data:application/pdf;base64,XXXXX"
        const match = doc_comprobante_ingresos_b64.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) throw new Error('Formato base64 inválido');
        mediaType = match[1];
        base64 = match[2];
        if (mediaType.includes('pdf')) mediaType = 'application/pdf';
        else if (mediaType.includes('png')) mediaType = 'image/png';
        else if (mediaType.includes('jpg') || mediaType.includes('jpeg')) mediaType = 'image/jpeg';
      } else {
        // Descargar desde URL
        const fileRes = await fetch(file_ingresos);
        if (!fileRes.ok) throw new Error('No se pudo descargar el archivo');
        const contentType = fileRes.headers.get('content-type') || 'image/jpeg';
        const buffer = await fileRes.arrayBuffer();
        base64 = Buffer.from(buffer).toString('base64');
        mediaType = contentType.includes('pdf') ? 'application/pdf' :
                    contentType.includes('png') ? 'image/png' : 'image/jpeg';
      }

      const isPDF = mediaType === 'application/pdf';

      // Llamar a Claude API
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
              {
                type: isPDF ? 'document' : 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              },
              {
                type: 'text',
                text: `Analiza este documento de ingresos y responde SOLO en formato JSON con estos campos:
{
  "tipo_documento": "nomina|estado_cuenta|declaracion_fiscal|otro",
  "ingreso_mensual": número (ingreso mensual neto en pesos mexicanos, si es estado de cuenta calcula el promedio de depósitos de los últimos 3 meses, si es declaración fiscal divide el ingreso anual entre 12),
  "periodo": "descripción breve del periodo que cubre",
  "empleador_o_actividad": "nombre del empleador o actividad económica",
  "confianza": "alta|media|baja"
}
Si no puedes determinar el ingreso con certeza, pon null en ingreso_mensual.
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

  let resultado, color, icono, mensaje;

  if (!ingresoEvaluar || ingresoEvaluar === 0) {
    resultado = 'pendiente';
    color = '#92400e';
    icono = '⏳';
    mensaje = 'No se pudo determinar el ingreso automáticamente. Tu abogada revisará el documento manualmente.';
  } else if (ingresoEvaluar >= ingresoRequerido) {
    resultado = 'viable';
    color = '#065f46';
    icono = '✅';
    mensaje = `Tus ingresos califican para esta renta. Relación ingreso/renta: ${razonIngreso}x (mínimo requerido: ${multiplicador}x).`;
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
