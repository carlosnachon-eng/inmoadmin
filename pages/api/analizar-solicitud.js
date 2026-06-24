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

const promptBase = (nombre) => `Actúa exclusivamente como analista documental. Extrae y describe información visible; no apruebes, no rechaces y no emitas dictamen final.
Solicitante declarado: "${nombre}".
Fecha actual: ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}.
Responde SOLO con JSON válido, sin texto adicional. Si un dato no es legible o no existe, usa null y agrégalo a "informacion_faltante".`;

const prompts = {
  ine: (nombre) => `${promptBase(nombre)}
Este documento debe ser una identificación oficial (INE o equivalente).
{
  "tipo_documento": "ine",
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
No declares que el documento es auténtico o falso; solo describe señales visibles.`,

  ingresos: (nombre) => `${promptBase(nombre)}
Este documento debe ser un comprobante de ingresos, nómina, estado de cuenta o declaración fiscal.
{
  "tipo_documento": "nomina_quincenal|nomina_mensual|estado_cuenta|declaracion_fiscal|otro",
  "nombre_en_documentos": "nombre completo o null",
  "nombre_coincide": true|false,
  "institucion_o_empleador": "institución financiera o empleador o null",
  "fecha_documento": "fecha de emisión o corte o null",
  "ingreso_bruto": número o null,
  "ingreso_neto": número o null,
  "ingreso_mensual_total": número o null,
  "ingreso_mensual_verificable": número o null,
  "periodo": "periodo cubierto o null",
  "empleador_o_actividad": "empleador o actividad o null",
  "origen_ingresos": "descripción objetiva de depósitos",
  "depositos_recurrentes": número o null,
  "depositos_recurrentes_mensuales": número o null,
  "depositos_extraordinarios": número o null,
  "posibles_transferencias_propias": número o null,
  "inconsistencias": ["diferencias observadas"],
  "riesgos_observados": ["patrones que requieren revisión humana"],
  "informacion_faltante": ["datos ausentes o ilegibles"],
  "preguntas_revision_humana": ["preguntas concretas para jurídico"],
  "resumen_analista": "resumen breve",
  "confianza": "alta|media|baja",
  "alertas": ["observaciones con montos y periodos"]
}
REGLAS:
1. Calcula ingreso_mensual_total cuando sea posible.
2. No uses saldo promedio como ingreso.
3. Separa depósitos recurrentes de extraordinarios.
4. Si tiene más de 4 meses, agrega "Documento vencido" a alertas.
5. No determines licitud, aprobación ni capacidad final de pago.`,

  carta_laboral: (nombre) => `${promptBase(nombre)}
Este documento debe ser una carta laboral.
{
  "tipo_documento": "carta_laboral",
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
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: [
          { type: mediaType === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: prompts[documento.tipo](nombre) },
        ],
      }],
    }),
  });

  if (!claudeRes.ok) throw new Error('Error Claude API: ' + await claudeRes.text());
  const data = await claudeRes.json();
  const texto = data.content?.[0]?.text || '';
  const jsonMatch = texto.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude no devolvió JSON válido');

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('No se pudo interpretar el JSON de Claude');
  }
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

  const guardarAuditoria = async (revisionManual) => {
    const audit = { ia_revision_manual: revisionManual };
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
    await guardarAuditoria(true);
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
      r.ingreso_neto,
      r.ingreso_mensual_total,
      r.depositos_recurrentes_mensuales,
      r.depositos_recurrentes
    ))
    .filter(Boolean);
  const ingresosTotales = docsIngresos
    .map(r => primerMonto(
      r.ingreso_mensual_total,
      r.ingreso_bruto,
      r.ingreso_neto,
      r.depositos_recurrentes_mensuales,
      r.depositos_recurrentes
    ))
    .filter(Boolean);
  const promedioIngreso = ingresosVerificables.length ? ingresosVerificables.reduce((a, b) => a + b, 0) / ingresosVerificables.length : null;
  const promedioTotal = ingresosTotales.length ? ingresosTotales.reduce((a, b) => a + b, 0) / ingresosTotales.length : null;

  const resultadosDocumentales = exitosos.map(r => ({ tipo: r.documento.tipo, etiqueta: r.documento.etiqueta, ...r.data }));
  const inconsistenciasNombre = [];
  if (docINE?.nombre_en_documentos) {
    resultadosDocumentales
      .filter(d => d.tipo !== 'ine' && d.nombre_en_documentos && !nombresCoinciden(docINE.nombre_en_documentos, d.nombre_en_documentos))
      .forEach(d => inconsistenciasNombre.push(`Nombre en INE (${docINE.nombre_en_documentos}) no coincide con ${d.etiqueta} (${d.nombre_en_documentos})`));
  }

  const alertas = [...new Set([
    ...resultadosDocumentales.flatMap(r => r.alertas || []),
    ...resultadosDocumentales.flatMap(r => r.inconsistencias || []),
    ...resultadosDocumentales.flatMap(r => r.riesgos_observados || []),
    ...inconsistenciasNombre,
    ...faltantesRequeridos.map(d => `Documento requerido faltante: ${d}`),
    ...fallidos.map(r => `No se pudo analizar ${r.documento.etiqueta}: ${r.error}`),
  ])].filter(Boolean);

  const riesgosObservados = [...new Set(resultadosDocumentales.flatMap(r => r.riesgos_observados || []))];
  const nombresNoCoinciden = resultadosDocumentales.some(r => r.nombre_coincide === false) || inconsistenciasNombre.length > 0;
  const resumenAnalista = resultadosDocumentales.map(r => r.resumen_analista).filter(Boolean).join(' | ');
  const preguntasRevision = [...new Set(resultadosDocumentales.flatMap(r => r.preguntas_revision_humana || []))];
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
      documentos: docsIngresos.map(d => ({
        tipo_documento: d.tipo_documento,
        titular: d.nombre_en_documentos || null,
        periodo: d.periodo || null,
        fecha_documento: d.fecha_documento || null,
        institucion_o_empleador: d.institucion_o_empleador || d.empleador_o_actividad || null,
        ingreso_bruto: normalizarMonto(d.ingreso_bruto),
        ingreso_neto: normalizarMonto(d.ingreso_neto),
        depositos_recurrentes: normalizarMonto(d.depositos_recurrentes),
        depositos_recurrentes_mensuales: normalizarMonto(d.depositos_recurrentes_mensuales),
        depositos_extraordinarios: normalizarMonto(d.depositos_extraordinarios),
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
    mensajeInterno = `Revisión manual requerida. ${analisisIA.alertas.join('. ')}`.trim();
  } else if (curpFallo) {
    resultado = 'revisar';
    color = '#92400e';
    icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico revisará tus documentos y te contactará en breve.';
    mensajeInterno = `CURP inválida en RENAPO: ${validacionCurp?.curp_status || 'no verificada'}. ${analisisIA.alertas.join('. ')}`.trim();
  } else if (!ingresoEvaluar) {
    resultado = 'revisar';
    color = '#92400e';
    icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico la revisará y te contactará en breve.';
    mensajeInterno = `No se pudo calcular el ingreso desde los documentos.${analisisIA.alertas.length ? ` Alertas: ${analisisIA.alertas.join('. ')}` : ''}`;
  } else if (!nombreCoincide) {
    resultado = 'revisar';
    color = '#92400e';
    icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico revisará tus documentos y te contactará en breve.';
    mensajeInterno = `Se detectaron inconsistencias de identidad: ${inconsistenciasNombre.join('. ') || 'el nombre no coincide con el solicitante'}.`;
  } else if (ingresoEvaluar >= ingresoRequerido) {
    resultado = analisisIA.alertas.length ? 'revisar' : 'viable';
    color = analisisIA.alertas.length ? '#92400e' : '#065f46';
    icono = analisisIA.alertas.length ? '⚠️' : '✅';
    mensaje = analisisIA.alertas.length
      ? 'Tus documentos han sido recibidos. Nuestro equipo los revisará y te contactará en breve.'
      : '¡Buenas noticias! Tus ingresos califican preliminarmente para esta renta. Nuestro equipo confirmará los detalles contigo.';
    mensajeInterno = analisisIA.alertas.length ? `Ingresos suficientes pero con observaciones documentales: ${analisisIA.alertas.join('. ')}` : null;
  } else {
    resultado = 'revisar';
    color = '#92400e';
    icono = '⚠️';
    mensaje = 'Hemos recibido tu solicitud. Nuestro equipo jurídico la revisará y te contactará en breve.';
    mensajeInterno = ingresoEvaluar >= ingresoRequerido * 0.85
      ? `Ingresos cerca del límite: relación ${razonIngreso}x (mínimo ${multiplicador}x).`
      : `Ingresos por debajo del criterio preliminar: relación ${razonIngreso}x (mínimo ${multiplicador}x).`;
  }

  await guardarAuditoria(revisionManual);

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
