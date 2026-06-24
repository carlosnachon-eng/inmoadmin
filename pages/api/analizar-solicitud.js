import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 60,
};

const normalizar = (s = '') => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const nombresCoinciden = (a, b) => {
  const palabrasA = normalizar(a).split(/\s+/).filter(p => p.length > 2);
  const textoB = normalizar(b);
  return palabrasA.length > 0 && palabrasA.filter(p => textoB.includes(p)).length >= Math.min(2, palabrasA.length);
};

const normalizarMonto = (valor) => {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;

  let limpio = valor.trim().replace(/[^\d,.-]/g, '');
  if (!limpio) return null;

  const ultimaComa = limpio.lastIndexOf(',');
  const ultimoPunto = limpio.lastIndexOf('.');
  if (ultimaComa > -1 && ultimoPunto > -1) {
    if (ultimaComa > ultimoPunto) {
      limpio = limpio.replace(/\./g, '').replace(',', '.');
    } else {
      limpio = limpio.replace(/,/g, '');
    }
  } else if (ultimaComa > -1) {
    const decimales = limpio.length - ultimaComa - 1;
    limpio = decimales > 0 && decimales <= 2 ? limpio.replace(',', '.') : limpio.replace(/,/g, '');
  }

  const numero = Number(limpio);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
};

const primerMonto = (...valores) => {
  for (const valor of valores) {
    const monto = normalizarMonto(valor);
    if (monto) return monto;
  }
  return null;
};

const filtrarHallazgos = (valores = []) => {
  const anioActual = new Date().getFullYear();
  return valores.filter(valor => {
    const texto = String(valor || '');
    if (/identidad de g[eé]nero|cambio de g[eé]nero|discrepancia.*g[eé]nero|g[eé]nero declarado/i.test(texto)) return false;
    if (/documento vencido/i.test(texto)) {
      const rango = texto.match(/\b(20\d{2})\s*[-–]\s*(20\d{2})\b/);
      if (rango && anioActual >= Number(rango[1]) && anioActual <= Number(rango[2])) return false;
    }
    return true;
  });
};

const promptBase = (nombre) => `Actúa exclusivamente como analista documental. Extrae y describe información visible; no apruebes, no rechaces y no emitas dictamen final.
Solicitante declarado: "${nombre}".
Fecha actual: ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}.
Responde SOLO con JSON válido, sin texto adicional. Si un dato no es legible o no existe, usa null y agrégalo a "informacion_faltante".
Incluye siempre "documento_legible": true|false y "motivo_fallo": string|null.
Si el PDF está cifrado, protegido con contraseña, dañado o no permite leer su contenido, devuelve documento_legible=false y explica la causa en motivo_fallo.
Los textos "true|false", "número o null" y similares describen el tipo esperado: reemplázalos por un valor JSON real. No los copies literalmente.`;

const prompts = {
  ine: (nombre) => `${promptBase(nombre)}
Este documento debe ser una identificación oficial (INE o equivalente).
{
  "tipo_documento": "ine",
  "documento_legible": true|false,
  "motivo_fallo": "causa o null",
  "nombre_en_documentos": "nombre completo o null",
  "nombre_coincide": true|false,
  "curp_detectada": "CURP o null",
  "clave_elector": "clave o null",
  "fecha_nacimiento": "fecha o null",
  "vigencia": "vigencia o null",
  "elementos_visuales_observados": ["elementos visibles, sin afirmar autenticidad"],
  "inconsistencias": ["diferencias observadas"],
  "riesgos_observados": ["señales que requieren revisión humana"],
  "informacion_faltante": ["campos ausentes o ilegibles"],
  "preguntas_revision_humana": ["preguntas concretas para jurídico"],
  "resumen_analista": "resumen breve",
  "confianza": "alta|media|baja",
  "alertas": ["observaciones relevantes"]
}
No declares que el documento es auténtico o falso; solo describe señales visibles.
En documentos mexicanos, el marcador de sexo "M" significa Mujer y "H" significa Hombre. No infieras identidad de género ni cambios de identidad.
Una vigencia expresada como rango es válida mientras el año actual esté dentro del rango; no la marques como vencida en ese caso.`,

  ingresos: (nombre) => `${promptBase(nombre)}
Este documento debe ser un comprobante de ingresos, nómina, estado de cuenta o declaración fiscal.
{
  "tipo_documento": "nomina_quincenal|nomina_mensual|estado_cuenta|declaracion_fiscal|otro",
  "documento_legible": true|false,
  "motivo_fallo": "causa o null",
  "nombre_en_documentos": "nombre completo o null",
  "nombre_coincide": true|false,
  "institucion_o_empleador": "institución financiera o empleador o null",
  "fecha_documento": "fecha de emisión o corte o null",
  "ingreso_bruto": número o null,
  "ingreso_neto": número o null,
  "ingreso_mensual_total": número o null,
  "ingreso_mensual_verificable": número o null,
  "ingreso_mensual_estimado": número o null,
  "metodo_calculo_ingreso": "explicación breve del cálculo o motivo por el que no pudo calcularse",
  "periodo": "periodo cubierto o null",
  "meses_cubiertos": número o null,
  "empleador_o_actividad": "empleador o actividad o null",
  "origen_ingresos": "descripción objetiva de depósitos",
  "depositos_recurrentes": número o null,
  "depositos_recurrentes_mensuales": número o null,
  "depositos_extraordinarios": número o null,
  "posibles_transferencias_propias": número o null,
  "montos_detectados": [
    {
      "concepto": "concepto visible",
      "monto": número,
      "fecha": "fecha visible o null",
      "clasificacion": "nomina|deposito_recurrente|deposito_extraordinario|transferencia_propia|saldo|otro"
    }
  ],
  "inconsistencias": ["diferencias observadas"],
  "riesgos_observados": ["patrones que requieren revisión humana"],
  "informacion_faltante": ["datos ausentes o ilegibles"],
  "preguntas_revision_humana": ["preguntas concretas para jurídico"],
  "resumen_analista": "resumen breve",
  "confianza": "alta|media|baja",
  "alertas": ["observaciones con montos y periodos"]
}
REGLAS:
1. Registra en montos_detectados todos los importes relevantes visibles, aunque no sea posible calcular un ingreso mensual.
2. En nómina, mensualiza el ingreso neto según el periodo: semanal x 4.33, catorcenal x 2.17, quincenal x 2 y mensual x 1.
3. En estados de cuenta, calcula ingreso_mensual_estimado únicamente con depósitos identificables como ingresos recurrentes y divídelos entre los meses cubiertos.
4. No uses saldos, préstamos, transferencias propias ni depósitos extraordinarios como ingreso recurrente.
5. Si no puedes calcularlo, devuelve null y explica la causa en metodo_calculo_ingreso.
6. Si tiene más de 4 meses, agrega "Documento vencido" a alertas.
7. No determines licitud, aprobación ni capacidad final de pago.`,

  carta_laboral: (nombre) => `${promptBase(nombre)}
Este documento debe ser una carta laboral.
{
  "tipo_documento": "carta_laboral",
  "documento_legible": true|false,
  "motivo_fallo": "causa o null",
  "nombre_en_documentos": "nombre del trabajador o null",
  "nombre_coincide": true|false,
  "empleador_o_actividad": "empresa o empleador o null",
  "puesto": "puesto o null",
  "antiguedad": "antigüedad o fecha de ingreso o null",
  "ingreso_mensual_total": número o null,
  "fecha_documento": "fecha o null",
  "firmante": "nombre y cargo o null",
  "datos_contacto": "teléfono/correo o null",
  "inconsistencias": ["diferencias observadas"],
  "riesgos_observados": ["señales para revisión humana"],
  "informacion_faltante": ["datos ausentes o ilegibles"],
  "preguntas_revision_humana": ["preguntas concretas para jurídico"],
  "resumen_analista": "resumen breve",
  "confianza": "alta|media|baja",
  "alertas": ["observaciones relevantes"]
}
No confirmes autenticidad, relación laboral vigente ni aprobación.`,

  constancia_fiscal: (nombre) => `${promptBase(nombre)}
Este documento debe ser una constancia de situación fiscal.
{
  "tipo_documento": "constancia_fiscal",
  "documento_legible": true|false,
  "motivo_fallo": "causa o null",
  "nombre_en_documentos": "nombre o razón social o null",
  "nombre_coincide": true|false,
  "rfc_detectado": "RFC o null",
  "regimenes_fiscales": ["regímenes detectados"],
  "actividades_economicas": ["actividades detectadas"],
  "fecha_documento": "fecha de emisión o null",
  "estatus_detectado": "estatus visible o null",
  "inconsistencias": ["diferencias observadas"],
  "riesgos_observados": ["señales para revisión humana"],
  "informacion_faltante": ["datos ausentes o ilegibles"],
  "preguntas_revision_humana": ["preguntas concretas para jurídico"],
  "resumen_analista": "resumen breve",
  "confianza": "alta|media|baja",
  "alertas": ["observaciones relevantes"]
}
No determines licitud, autenticidad ni aprobación.`,
};

const promptIngresosCompacto = (nombre) => `Actúa exclusivamente como extractor documental.
Solicitante declarado: "${nombre}".
Devuelve SOLO este objeto JSON válido y conciso, sin markdown ni comentarios:
{
  "tipo_documento": "nomina_quincenal|nomina_mensual|estado_cuenta|declaracion_fiscal|otro",
  "documento_legible": true,
  "motivo_fallo": null,
  "nombre_en_documentos": "nombre o null",
  "nombre_coincide": true,
  "institucion_o_empleador": "texto o null",
  "fecha_documento": "texto o null",
  "periodo": "texto o null",
  "ingreso_bruto": null,
  "ingreso_neto": null,
  "ingreso_mensual_total": null,
  "ingreso_mensual_verificable": null,
  "ingreso_mensual_estimado": null,
  "depositos_recurrentes": null,
  "depositos_recurrentes_mensuales": null,
  "depositos_extraordinarios": null,
  "metodo_calculo_ingreso": "explicación breve",
  "montos_detectados": [],
  "inconsistencias": [],
  "riesgos_observados": [],
  "informacion_faltante": [],
  "preguntas_revision_humana": [],
  "resumen_analista": "resumen breve",
  "confianza": "alta|media|baja",
  "alertas": []
}
Usa números JSON sin símbolos ni comas. Para nómina mensualiza el neto según el periodo. Para estado de cuenta usa solo depósitos recurrentes identificables; nunca uses el saldo. No apruebes, rechaces ni emitas dictamen.`;

const herramientaIngresos = {
  name: 'registrar_analisis_ingresos',
  description: 'Registra únicamente los datos visibles de un comprobante de ingresos mexicano. Debe usarse una vez por documento. No aprueba, rechaza ni determina licitud.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tipo_documento: { type: 'string', enum: ['nomina_quincenal', 'nomina_mensual', 'estado_cuenta', 'declaracion_fiscal', 'otro'] },
      documento_legible: { type: 'boolean' },
      motivo_fallo: { type: ['string', 'null'] },
      nombre_en_documentos: { type: ['string', 'null'] },
      nombre_coincide: { type: 'boolean' },
      institucion_o_empleador: { type: ['string', 'null'] },
      fecha_documento: { type: ['string', 'null'] },
      periodo: { type: ['string', 'null'] },
      ingreso_bruto: { type: ['number', 'null'] },
      ingreso_neto: { type: ['number', 'null'] },
      ingreso_mensual_total: { type: ['number', 'null'] },
      ingreso_mensual_verificable: { type: ['number', 'null'] },
      ingreso_mensual_estimado: { type: ['number', 'null'] },
      depositos_recurrentes: { type: ['number', 'null'] },
      depositos_recurrentes_mensuales: { type: ['number', 'null'] },
      depositos_extraordinarios: { type: ['number', 'null'] },
      metodo_calculo_ingreso: { type: ['string', 'null'] },
      inconsistencias: { type: 'array', items: { type: 'string' } },
      riesgos_observados: { type: 'array', items: { type: 'string' } },
      informacion_faltante: { type: 'array', items: { type: 'string' } },
      preguntas_revision_humana: { type: 'array', items: { type: 'string' } },
      resumen_analista: { type: 'string' },
      confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
      alertas: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'tipo_documento', 'documento_legible', 'motivo_fallo', 'nombre_en_documentos',
      'nombre_coincide', 'institucion_o_empleador', 'fecha_documento', 'periodo',
      'ingreso_bruto', 'ingreso_neto', 'ingreso_mensual_total',
      'ingreso_mensual_verificable', 'ingreso_mensual_estimado',
      'depositos_recurrentes', 'depositos_recurrentes_mensuales',
      'depositos_extraordinarios', 'metodo_calculo_ingreso', 'inconsistencias',
      'riesgos_observados', 'informacion_faltante', 'preguntas_revision_humana',
      'resumen_analista', 'confianza', 'alertas'
    ],
  },
};

async function autorizarReanalisis(req) {
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return { error: 'Sesión requerida para reanalizar', status: 401 };

  const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !user) return { error: 'Sesión inválida', status: 401 };

  const { data: perfil, error: perfilError } = await supabase
    .from('profiles')
    .select('id, email, full_name, role_id')
    .eq('id', user.id)
    .maybeSingle();

  if (perfilError || !perfil) return { error: 'Perfil no encontrado', status: 403 };
  if (!['admin', 'juridico'].includes(perfil.role_id)) {
    return { error: 'Solo Jurídico o Admin puede reanalizar', status: 403 };
  }

  return { user, perfil };
}

async function cargarArchivo(input) {
  if (input.startsWith('data:')) {
    const match = input.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Formato base64 inválido');
    return {
      mediaType: match[1].includes('pdf') ? 'application/pdf' : match[1].includes('png') ? 'image/png' : 'image/jpeg',
      base64: match[2],
    };
  }

  const fileRes = await fetch(input);
  if (!fileRes.ok) throw new Error(`No se pudo descargar el documento (${fileRes.status})`);
  const contentType = fileRes.headers.get('content-type') || 'image/jpeg';
  return {
    mediaType: contentType.includes('pdf') ? 'application/pdf' : contentType.includes('png') ? 'image/png' : 'image/jpeg',
    base64: Buffer.from(await fileRes.arrayBuffer()).toString('base64'),
  };
}

async function analizarDocumento(documento, nombre) {
  const { mediaType, base64 } = await cargarArchivo(documento.input);
  const contenidoDocumento = {
    type: mediaType === 'application/pdf' ? 'document' : 'image',
    source: { type: 'base64', media_type: mediaType, data: base64 },
  };

  const analizarIngresosEstructurado = async () => {
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
        max_tokens: 1600,
        temperature: 0,
        tools: [herramientaIngresos],
        tool_choice: { type: 'tool', name: 'registrar_analisis_ingresos' },
        messages: [{
          role: 'user',
          content: [
            contenidoDocumento,
            { type: 'text', text: promptIngresosCompacto(nombre) },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) {
      const errorTexto = await claudeRes.text();
      if (/password protected|contraseñ|cifrad|encrypted/i.test(errorTexto)) {
        throw new Error('PDF protegido con contraseña; solicita una copia sin protección');
      }
      throw new Error(`Claude no pudo procesar el comprobante (${claudeRes.status})`);
    }

    const data = await claudeRes.json();
    const usoHerramienta = (data.content || []).find(bloque =>
      bloque?.type === 'tool_use' && bloque?.name === 'registrar_analisis_ingresos'
    );
    if (!usoHerramienta?.input) throw new Error('Claude no devolvió la extracción estructurada del comprobante');
    return usoHerramienta.input;
  };

  if (documento.tipo === 'ingresos') {
    const resultado = await analizarIngresosEstructurado();
    if (resultado.documento_legible === false) {
      throw new Error(resultado.motivo_fallo || 'Documento de ingresos ilegible');
    }
    return resultado;
  }

  const llamarClaude = async ({ esReintento = false, promptAlterno = null } = {}) => {
    const prompt = promptAlterno || `${prompts[documento.tipo](nombre)}
${esReintento ? '\nSEGUNDO INTENTO: La respuesta anterior no fue JSON válido. Sé conciso, completa todas las llaves y devuelve únicamente un objeto JSON parseable.' : ''}`;
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
        max_tokens: promptAlterno ? 1000 : esReintento ? 1800 : 1800,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            contenidoDocumento,
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) {
      const errorTexto = await claudeRes.text();
      if (/password protected|contraseñ|cifrad|encrypted/i.test(errorTexto)) {
        throw new Error('PDF protegido con contraseña; solicita una copia sin protección');
      }
      throw new Error(`Claude no pudo procesar el documento (${claudeRes.status})`);
    }
    return claudeRes.json();
  };

  const interpretarJSON = (data) => {
    const texto = (data.content || []).map(bloque => bloque?.text || '').join('').trim();
    const sinBloques = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const inicio = sinBloques.indexOf('{');
    const fin = sinBloques.lastIndexOf('}');
    if (inicio < 0 || fin <= inicio) return null;
    try {
      return JSON.parse(sinBloques.slice(inicio, fin + 1));
    } catch {
      return null;
    }
  };

  let data = await llamarClaude();
  let resultado = interpretarJSON(data);
  if (!resultado) {
    data = await llamarClaude({ esReintento: true });
    resultado = interpretarJSON(data);
  }
  if (!resultado) {
    throw new Error('Claude no devolvió JSON válido después de un reintento');
  }

  const textoFallo = [
    resultado.motivo_fallo,
    ...(Array.isArray(resultado.informacion_faltante) ? resultado.informacion_faltante : []),
    ...(Array.isArray(resultado.alertas) ? resultado.alertas : []),
  ].filter(Boolean).join(' ');
  const pareceProtegido = /contraseñ|password|cifrad|encript|protegido|no se puede abrir/i.test(textoFallo);
  if (resultado.documento_legible === false || pareceProtegido) {
    throw new Error(resultado.motivo_fallo || (pareceProtegido ? 'PDF protegido con contraseña o cifrado' : 'Documento ilegible'));
  }
  return resultado;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { solicitud_id, tipo_ejecucion = 'inicial', motivo } = req.body;
  if (!solicitud_id) return res.status(400).json({ error: 'solicitud_id requerido' });
  if (!['inicial', 'reanalisis'].includes(tipo_ejecucion)) return res.status(400).json({ error: 'tipo_ejecucion inválido' });

  let reanalisisPor = null;
  if (tipo_ejecucion === 'reanalisis') {
    if (!motivo?.trim()) return res.status(400).json({ error: 'Motivo de reanálisis requerido' });
    const autorizacion = await autorizarReanalisis(req);
    if (autorizacion.error) return res.status(autorizacion.status).json({ error: autorizacion.error });
    reanalisisPor = autorizacion.perfil.full_name || autorizacion.perfil.email || autorizacion.user.email;
  }

  const { data: sol, error: solError } = await supabase
    .from('solicitudes_inquilino')
    .select('nombre_completo, razon_social, tipo_ingresos, ingresos_mensuales, ingresos_empresa, monto_renta_solicitada, doc_comprobante_ingresos_b64, doc_ingresos_b64_2, doc_ingresos_b64_3, doc_identificacion_b64, doc_carta_laboral_b64, doc_constancia_fiscal_b64, curp, pre_viabilidad')
    .eq('id', solicitud_id)
    .single();

  if (solError || !sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
  if (tipo_ejecucion === 'inicial' && sol.pre_viabilidad) {
    return res.status(409).json({ error: 'El análisis inicial ya fue ejecutado; usa el reanálisis interno' });
  }

  const tipo_ingresos = sol.tipo_ingresos;
  const nombre = sol.nombre_completo || sol.razon_social || 'Solicitante';
  const renta = parseFloat(sol.monto_renta_solicitada) || 0;
  const esNegocioPropio = ['Negocio propio', 'Actividad empresarial', 'Persona moral'].some(t => (tipo_ingresos || '').includes(t));
  const multiplicador = esNegocioPropio ? 3 : 2.5;
  const ingresoRequerido = renta * multiplicador;

  const documentos = [
    { tipo: 'ine', etiqueta: 'INE', input: sol.doc_identificacion_b64, requerido: true },
    { tipo: 'ingresos', etiqueta: 'Comprobante de ingresos 1', input: sol.doc_comprobante_ingresos_b64, requerido: true },
    { tipo: 'ingresos', etiqueta: 'Comprobante de ingresos 2', input: sol.doc_ingresos_b64_2, requerido: false },
    { tipo: 'ingresos', etiqueta: 'Comprobante de ingresos 3', input: sol.doc_ingresos_b64_3, requerido: false },
    { tipo: 'carta_laboral', etiqueta: 'Carta laboral', input: sol.doc_carta_laboral_b64, requerido: false },
    { tipo: 'constancia_fiscal', etiqueta: 'Constancia fiscal', input: sol.doc_constancia_fiscal_b64, requerido: false },
  ];
  const documentosPresentes = documentos.filter(d => d.input);
  const faltantesRequeridos = documentos.filter(d => d.requerido && !d.input).map(d => d.etiqueta);
  const tieneDocumentosIngresos = documentosPresentes.some(d => d.tipo === 'ingresos');

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

  const curpFallo = validacionCurp && validacionCurp.valido !== true;

  const guardarAuditoria = async (revisionManual, detalles = {}) => {
    const audit = {
      ia_revision_manual: revisionManual,
      ia_ultimo_analisis_en: new Date().toISOString(),
      ...detalles,
    };
    if (tipo_ejecucion === 'reanalisis') {
      audit.ia_reanalizado_por = reanalisisPor;
      audit.ia_reanalizado_en = new Date().toISOString();
      audit.ia_reanalisis_motivo = motivo.trim();
    }
    const { error } = await supabase.from('solicitudes_inquilino').update(audit).eq('id', solicitud_id);
    if (error) console.error('Error guardando auditoría IA:', error.message);
  };

  if (!tieneDocumentosIngresos) {
    const alertas = ['No se encontraron documentos de ingresos adjuntos'];
    if (faltantesRequeridos.length) alertas.push(`Documentos requeridos faltantes: ${faltantesRequeridos.join(', ')}`);
    if (curpFallo) alertas.push(`CURP no válida en RENAPO: ${validacionCurp?.curp_status || 'error de verificación'}`);
    await guardarAuditoria(true, {
      ia_analisis_documental: {
        identidad_detectada: null,
        ingresos_detectados: null,
        documentos_analizados: [],
        documentos_fallidos: [],
        informacion_faltante: alertas,
        revision_manual: true,
      },
      ia_resumen_juridico: alertas.join('. '),
    });
    return res.status(200).json({
      resultado: 'pendiente',
      icono: '⏳',
      color: '#92400e',
      mensaje: 'Hemos recibido tu solicitud. Nuestro equipo jurídico revisará tus documentos y te contactará en breve.',
      mensajeInterno: alertas.join('. '),
      validacionCurp,
      detalles: {
        nombre, renta, multiplicador, ingresoRequerido,
        ingresoDetectado: null, ingresoEvaluar: null,
        analisisIA: { alertas, confianza: 'baja', revision_manual: true, documentos_analizados: [] },
        sin_documentos: true,
      },
    });
  }

  const resultados = await Promise.all(documentosPresentes.map(async documento => {
    try {
      return { documento, ok: true, data: await analizarDocumento(documento, nombre) };
    } catch (e) {
      return { documento, ok: false, error: e.message };
    }
  }));

  const exitosos = resultados.filter(r => r.ok);
  const fallidos = resultados.filter(r => !r.ok);
  const revisionManual = faltantesRequeridos.length > 0 || fallidos.length > 0;
  const docINE = exitosos.find(r => r.documento.tipo === 'ine')?.data;
  const docsIngresos = exitosos.filter(r => r.documento.tipo === 'ingresos').map(r => r.data);
  const cartaLaboral = exitosos.find(r => r.documento.tipo === 'carta_laboral')?.data;
  const constanciaFiscal = exitosos.find(r => r.documento.tipo === 'constancia_fiscal')?.data;

  const ingresosVerificables = docsIngresos
    .map(r => primerMonto(
      r.ingreso_mensual_verificable,
      r.ingreso_mensual_estimado,
      r.ingreso_neto,
      r.ingreso_mensual_total,
      r.depositos_recurrentes_mensuales,
      r.depositos_recurrentes
    ))
    .filter(Boolean);
  const ingresosTotales = docsIngresos
    .map(r => primerMonto(
      r.ingreso_mensual_total,
      r.ingreso_mensual_estimado,
      r.ingreso_bruto,
      r.ingreso_neto,
      r.depositos_recurrentes_mensuales,
      r.depositos_recurrentes
    ))
    .filter(Boolean);
  const ingresoCartaLaboral = primerMonto(
    cartaLaboral?.ingreso_mensual_total,
    cartaLaboral?.ingreso_neto,
    cartaLaboral?.ingreso_bruto
  );
  const promedioIngresoDocumentos = ingresosVerificables.length ? ingresosVerificables.reduce((a, b) => a + b, 0) / ingresosVerificables.length : null;
  const promedioTotalDocumentos = ingresosTotales.length ? ingresosTotales.reduce((a, b) => a + b, 0) / ingresosTotales.length : null;
  const promedioIngreso = promedioIngresoDocumentos || ingresoCartaLaboral;
  const promedioTotal = promedioTotalDocumentos || ingresoCartaLaboral;
  const fuenteIngreso = promedioIngresoDocumentos ? 'comprobantes_ingresos' : ingresoCartaLaboral ? 'carta_laboral' : null;

  const resultadosDocumentales = exitosos.map(r => ({ tipo: r.documento.tipo, etiqueta: r.documento.etiqueta, ...r.data }));
  const inconsistenciasNombre = [];
  if (docINE?.nombre_en_documentos) {
    resultadosDocumentales
      .filter(d => d.tipo !== 'ine' && d.nombre_en_documentos && !nombresCoinciden(docINE.nombre_en_documentos, d.nombre_en_documentos))
      .forEach(d => inconsistenciasNombre.push(`Nombre en INE (${docINE.nombre_en_documentos}) no coincide con ${d.etiqueta} (${d.nombre_en_documentos})`));
  }

  const alertas = filtrarHallazgos([...new Set([
    ...resultadosDocumentales.flatMap(r => r.alertas || []),
    ...resultadosDocumentales.flatMap(r => r.inconsistencias || []),
    ...resultadosDocumentales.flatMap(r => r.riesgos_observados || []),
    ...inconsistenciasNombre,
    ...faltantesRequeridos.map(d => `Documento requerido faltante: ${d}`),
    ...fallidos.map(r => `No se pudo analizar ${r.documento.etiqueta}: ${r.error}`),
  ])].filter(Boolean));

  const riesgosObservados = filtrarHallazgos([...new Set(resultadosDocumentales.flatMap(r => r.riesgos_observados || []))]);
  const nombresNoCoinciden = resultadosDocumentales.some(r => r.nombre_coincide === false) || inconsistenciasNombre.length > 0;
  const resumenAnalista = resultadosDocumentales.map(r => r.resumen_analista).filter(Boolean).join(' | ');
  const preguntasRevision = filtrarHallazgos([...new Set(resultadosDocumentales.flatMap(r => r.preguntas_revision_humana || []))]);
  const informacionFaltante = [...new Set(resultadosDocumentales.flatMap(r => r.informacion_faltante || []))];

  const analisisIA = {
    nombre_en_documentos: docINE?.nombre_en_documentos || docsIngresos[0]?.nombre_en_documentos || null,
    identidad_detectada: docINE ? {
      nombre: docINE.nombre_en_documentos || null,
      curp: docINE.curp_detectada || null,
      clave_elector: docINE.clave_elector || null,
      fecha_nacimiento: docINE.fecha_nacimiento || null,
      vigencia: docINE.vigencia || null,
    } : null,
    ingresos_detectados: {
      ingreso_mensual_verificable: promedioIngreso,
      ingreso_mensual_total: promedioTotal,
      fuente_ingreso: fuenteIngreso,
      ingreso_carta_laboral: ingresoCartaLaboral,
      documentos: docsIngresos.map(d => ({
        tipo_documento: d.tipo_documento,
        titular: d.nombre_en_documentos || null,
        periodo: d.periodo || null,
        fecha_documento: d.fecha_documento || null,
        institucion_o_empleador: d.institucion_o_empleador || d.empleador_o_actividad || null,
        ingreso_bruto: normalizarMonto(d.ingreso_bruto),
        ingreso_neto: normalizarMonto(d.ingreso_neto),
        ingreso_mensual_estimado: normalizarMonto(d.ingreso_mensual_estimado),
        metodo_calculo_ingreso: d.metodo_calculo_ingreso || null,
        depositos_recurrentes: normalizarMonto(d.depositos_recurrentes),
        depositos_recurrentes_mensuales: normalizarMonto(d.depositos_recurrentes_mensuales),
        depositos_extraordinarios: normalizarMonto(d.depositos_extraordinarios),
        montos_detectados: Array.isArray(d.montos_detectados) ? d.montos_detectados : [],
      })),
    },
    nombre_coincide: !nombresNoCoinciden,
    ingreso_mensual: promedioIngreso,
    ingreso_mensual_total: promedioTotal,
    alertas,
    inconsistencias: inconsistenciasNombre,
    riesgos_observados: riesgosObservados,
    informacion_faltante: informacionFaltante,
    preguntas_revision_humana: preguntasRevision,
    documentos_analizados: resultadosDocumentales,
    documentos_fallidos: fallidos.map(r => ({ tipo: r.documento.tipo, etiqueta: r.documento.etiqueta, error: r.error })),
    tiene_ine: !!docINE,
    nombre_en_ine: docINE?.nombre_en_documentos,
    carta_laboral: cartaLaboral || null,
    constancia_fiscal: constanciaFiscal || null,
    resumen_analista: resumenAnalista,
    confianza: fallidos.length ? 'baja' : 'media',
    revision_manual: revisionManual,
  };

  if (validacionCurp) {
    if (validacionCurp.alertas?.length) analisisIA.alertas = [...analisisIA.alertas, ...validacionCurp.alertas];
    analisisIA.curp_validada = validacionCurp.valido;
    analisisIA.nombre_en_renapo = validacionCurp.nombre_en_renapo;
    analisisIA.curp_status = validacionCurp.curp_status;
  }

  const resumenJuridico = [
    docINE
      ? `Identidad detectada: ${docINE.nombre_en_documentos || 'nombre no legible'}${docINE.curp_detectada ? `; CURP ${docINE.curp_detectada}` : ''}${docINE.clave_elector ? `; clave de elector ${docINE.clave_elector}` : ''}${docINE.vigencia ? `; vigencia ${docINE.vigencia}` : ''}`
      : 'Identidad: INE no analizada',
    `Documentos analizados: ${exitosos.map(r => r.documento.etiqueta).join(', ') || 'ninguno'}`,
    fallidos.length
      ? `Documentos con fallo: ${fallidos.map(r => `${r.documento.etiqueta} (${r.error})`).join(', ')}`
      : null,
    promedioIngreso
      ? `Ingreso mensual detectado: $${promedioIngreso.toLocaleString('es-MX')}; fuente: ${fuenteIngreso === 'carta_laboral' ? 'carta laboral' : 'comprobantes de ingresos'}`
      : 'Ingreso mensual detectado: no calculable',
    cartaLaboral
      ? `Carta laboral: ${cartaLaboral.empleador_o_actividad || 'empresa no legible'}${cartaLaboral.puesto ? `; puesto ${cartaLaboral.puesto}` : ''}${cartaLaboral.antiguedad ? `; antigüedad ${cartaLaboral.antiguedad}` : ''}${ingresoCartaLaboral ? `; sueldo $${ingresoCartaLaboral.toLocaleString('es-MX')}` : ''}`
      : null,
    analisisIA.inconsistencias.length ? `Inconsistencias: ${analisisIA.inconsistencias.join('; ')}` : null,
    analisisIA.informacion_faltante.length ? `Información faltante: ${analisisIA.informacion_faltante.join('; ')}` : null,
    analisisIA.riesgos_observados.length ? `Riesgos observados: ${analisisIA.riesgos_observados.join('; ')}` : null,
    analisisIA.preguntas_revision_humana.length ? `Preguntas para revisión: ${analisisIA.preguntas_revision_humana.join('; ')}` : null,
  ].filter(Boolean).join(' | ');

  const ingresoDetectado = promedioIngreso;
  const ingresoEvaluar = ingresoDetectado || 0;
  const razonIngreso = ingresoEvaluar > 0 && renta > 0 ? (ingresoEvaluar / renta).toFixed(2) : null;
  const nombreCoincide = analisisIA.nombre_coincide !== false;

  let resultado, color, icono, mensaje, mensajeInterno = null;

  if (revisionManual) {
    resultado = 'pendiente';
    color = '#92400e';
    icono = '⏳';
    mensaje = 'Los documentos requieren revisión manual por nuestro equipo jurídico. Te contactaremos en breve.';
    mensajeInterno = `Revisión manual requerida. ${resumenJuridico}${analisisIA.alertas.length ? ` | Observaciones: ${analisisIA.alertas.join('. ')}` : ''}`.trim();
  } else if (curpFallo) {
    resultado = 'revisar';
    color = '#92400e';
    icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico revisará tus documentos y te contactará en breve.';
    mensajeInterno = `CURP inválida en RENAPO: ${validacionCurp?.curp_status || 'no verificada'}. ${resumenJuridico}${analisisIA.alertas.length ? ` | Observaciones: ${analisisIA.alertas.join('. ')}` : ''}`.trim();
  } else if (!ingresoEvaluar) {
    resultado = 'revisar';
    color = '#92400e';
    icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico la revisará y te contactará en breve.';
    const diagnosticoIngresos = docsIngresos
      .map((d, index) => {
        const metodo = d.metodo_calculo_ingreso || d.resumen_analista || 'sin explicación del documento';
        const montos = Array.isArray(d.montos_detectados)
          ? d.montos_detectados.map(m => `${m.concepto || m.clasificacion || 'monto'}: $${normalizarMonto(m.monto)?.toLocaleString('es-MX') || m.monto}`).join(', ')
          : '';
        return `Documento ${index + 1}: ${metodo}${montos ? `; montos visibles: ${montos}` : ''}`;
      })
      .join(' | ');
    mensajeInterno = `No se pudo calcular un ingreso mensual verificable desde los documentos.${diagnosticoIngresos ? ` ${diagnosticoIngresos}.` : ''} | ${resumenJuridico}${analisisIA.alertas.length ? ` | Observaciones: ${analisisIA.alertas.join('. ')}` : ''}`;
  } else if (!nombreCoincide) {
    resultado = 'revisar';
    color = '#92400e';
    icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico revisará tus documentos y te contactará en breve.';
    mensajeInterno = `Se detectaron inconsistencias de identidad: ${inconsistenciasNombre.join('. ') || 'el nombre no coincide con el solicitante'}. | ${resumenJuridico}`;
  } else if (ingresoEvaluar >= ingresoRequerido) {
    resultado = analisisIA.alertas.length ? 'revisar' : 'viable';
    color = analisisIA.alertas.length ? '#92400e' : '#065f46';
    icono = analisisIA.alertas.length ? '⚠️' : '✅';
    mensaje = analisisIA.alertas.length
      ? 'Tus documentos han sido recibidos. Nuestro equipo los revisará y te contactará en breve.'
      : '¡Buenas noticias! Tus ingresos califican preliminarmente para esta renta. Nuestro equipo confirmará los detalles contigo.';
    mensajeInterno = analisisIA.alertas.length
      ? `${resumenJuridico} | Observaciones documentales: ${analisisIA.alertas.join('. ')}`
      : fuenteIngreso === 'carta_laboral'
        ? `${resumenJuridico} | Los comprobantes no permitieron calcular un promedio verificable.`
        : resumenJuridico;
  } else {
    resultado = 'revisar';
    color = '#92400e';
    icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico la revisará y te contactará en breve.';
    mensajeInterno = ingresoEvaluar >= ingresoRequerido * 0.85
      ? `Ingresos cerca del límite: relación ${razonIngreso}x (mínimo ${multiplicador}x). | ${resumenJuridico}`
      : `Ingresos por debajo del criterio preliminar: relación ${razonIngreso}x (mínimo ${multiplicador}x). | ${resumenJuridico}`;
  }

  await guardarAuditoria(revisionManual, {
    ia_analisis_documental: analisisIA,
    ia_resumen_juridico: resumenJuridico,
  });

  return res.status(200).json({
    resultado, icono, color, mensaje, mensajeInterno,
    validacionCurp,
    detalles: {
      nombre, renta, multiplicador, ingresoRequerido,
      ingresoDetectado, ingresoEvaluar, razonIngreso,
      tipoDocumento: docsIngresos[0]?.tipo_documento || null,
      analisisIA,
      errorIA: fallidos.length ? fallidos.map(r => `${r.documento.etiqueta}: ${r.error}`).join(' | ') : null,
    },
  });
}
