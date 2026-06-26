import { createClient } from '@supabase/supabase-js';
import {
  clasificarConciliacionCierre,
  construirResumenConciliacion,
  dineroIgual,
  redondearMoneda,
  sumarMontos,
} from '../../../lib/ejecutivo/conciliacionCierres';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServerKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseServerKey
  ? createClient(supabaseUrl, supabaseServerKey)
  : null;

const ROLES_BI = new Set(['admin', 'direccion']);
const EMAILS_DIRECCION = new Set([
  'carlos.nachon@emporioinmobiliario.mx',
]);

const TABLA_IGNORADOS = 'bi_conciliacion_ignorados';

function obtenerToken(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return token;
}

function crearClienteSupabase(token) {
  if (!supabaseUrl || !supabaseServerKey) return null;
  return createClient(supabaseUrl, supabaseServerKey, token ? {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  } : undefined);
}

async function autenticarDireccion(req, cliente = supabase) {
  if (!cliente) return { error: 'Falta configuración de Supabase para conciliación', status: 500 };

  const token = obtenerToken(req);
  if (!token) return { error: 'Sesión requerida', status: 401 };

  const { data: { user }, error } = await cliente.auth.getUser(token);
  if (error || !user) return { error: 'Sesión inválida', status: 401 };

  const { data: perfil, error: perfilError } = await cliente
    .from('profiles')
    .select('id, full_name, email, role_id')
    .eq('id', user.id)
    .maybeSingle();

  if (perfilError) return { error: perfilError.message, status: 500 };

  const email = (perfil?.email || user.email || '').toLowerCase();
  const role = perfil?.role_id || null;
  const autorizado = ROLES_BI.has(role) || EMAILS_DIRECCION.has(email);

  if (!autorizado) {
    return { error: 'No tienes permiso para conciliación ejecutiva', status: 403 };
  }

  return { user, perfil: { ...perfil, email } };
}

function errorTablaNoExiste(error) {
  return error?.code === '42P01' || String(error?.message || '').includes('does not exist');
}

async function cargarIgnorados(cliente = supabase) {
  const { data, error } = await cliente
    .from(TABLA_IGNORADOS)
    .select('id, modulo, entidad_tipo, entidad_id, motivo, created_at, created_by')
    .eq('modulo', 'cierres')
    .eq('entidad_tipo', 'cierre');

  if (errorTablaNoExiste(error)) {
    return { disponibles: false, ignorados: new Map(), error: null };
  }
  if (error) throw error;

  const ignorados = new Map();
  (data || []).forEach((item) => {
    ignorados.set(String(item.entidad_id), item);
  });

  return { disponibles: true, ignorados, error: null };
}

async function cargarDatosConciliacion(cliente = supabase) {
  const { data: cierres, error: cierresError } = await cliente
    .from('cierres')
    .select('id, propiedad, fecha_cierre, comision, cobrado, pendiente, cobrado_bool, recibo_id, origen, notas, created_at, updated_at')
    .order('fecha_cierre', { ascending: false });

  if (cierresError) throw cierresError;

  const cierreIds = (cierres || []).map((cierre) => cierre.id).filter(Boolean);
  let pagos = [];

  if (cierreIds.length > 0) {
    const { data, error } = await cliente
      .from('cierre_pagos')
      .select('id, cierre_id, concepto, monto, fecha, metodo_pago, notas, created_at')
      .in('cierre_id', cierreIds)
      .order('fecha', { ascending: true });

    if (error) throw error;
    pagos = data || [];
  }

  const reciboIds = [...new Set((cierres || []).map((cierre) => cierre.recibo_id).filter(Boolean))];
  let recibos = [];

  if (reciboIds.length > 0) {
    const { data, error } = await cliente
      .from('recibos_apartado')
      .select('id, folio, cliente_nombre, inmueble, monto, monto_total_acordado, fecha, forma_pago, created_at, recibos_abonos(id, monto, fecha, forma_pago, notas, created_at)')
      .in('id', reciboIds);

    if (error) throw error;
    recibos = data || [];
  }

  const ignorados = await cargarIgnorados(cliente);

  return {
    cierres: cierres || [],
    pagos,
    recibos,
    ignorados,
  };
}

function mapearItems({ cierres, pagos, recibos, ignorados }) {
  const pagosPorCierre = new Map();
  pagos.forEach((pago) => {
    const key = String(pago.cierre_id);
    if (!pagosPorCierre.has(key)) pagosPorCierre.set(key, []);
    pagosPorCierre.get(key).push(pago);
  });

  const recibosPorId = new Map();
  recibos.forEach((recibo) => recibosPorId.set(String(recibo.id), recibo));

  return cierres.map((cierre) => {
    const pagosCierre = pagosPorCierre.get(String(cierre.id)) || [];
    const recibo = cierre.recibo_id ? recibosPorId.get(String(cierre.recibo_id)) : null;
    const ignorado = ignorados.ignorados.get(String(cierre.id)) || null;
    const clasificacion = clasificarConciliacionCierre({
      cierre,
      pagos: pagosCierre,
      recibo,
      ignorado,
    });

    return {
      id: cierre.id,
      propiedad: cierre.propiedad || '—',
      fecha_cierre: cierre.fecha_cierre,
      comision: redondearMoneda(cierre.comision || 0),
      cobrado_sistema: redondearMoneda(cierre.cobrado || 0),
      cobrado_trazable: sumarMontos(pagosCierre),
      pendiente_sistema: redondearMoneda(cierre.pendiente || 0),
      pendiente_reconstruido: clasificacion.pendiente_reconstruido,
      diferencia: clasificacion.diferencia,
      estado: clasificacion.estado,
      causa_probable: clasificacion.causa_probable,
      accion_sugerida: clasificacion.accion_sugerida,
      evidencia: clasificacion.evidencia,
      regularizacion: clasificacion.regularizacion,
      recibo_id: cierre.recibo_id || null,
      origen: cierre.origen || null,
      pagos_count: pagosCierre.length,
      created_at: cierre.created_at || null,
      updated_at: cierre.updated_at || null,
    };
  });
}

async function listarConciliacion(req, res, cliente = supabase) {
  const incluirConciliados = req.query?.include === 'all' || req.query?.include === 'conciliados';
  const incluirIgnorados = req.query?.include === 'all' || req.query?.include === 'ignorados';

  const datos = await cargarDatosConciliacion(cliente);
  const todos = mapearItems(datos);
  const resumen = construirResumenConciliacion(todos);

  const items = todos.filter((item) => {
    if (item.estado === 'conciliado') return incluirConciliados;
    if (item.estado === 'ignorado') return incluirIgnorados;
    return true;
  });

  return res.status(200).json({
    ok: true,
    generated_at: new Date().toISOString(),
    ignorados_disponibles: datos.ignorados.disponibles,
    resumen,
    items,
  });
}

async function regularizarCierre({ cierreId, user, cliente = supabase }) {
  const datos = await cargarDatosConciliacion(cliente);
  const items = mapearItems(datos);
  const item = items.find((registro) => String(registro.id) === String(cierreId));

  if (!item) {
    const error = new Error('Cierre no encontrado');
    error.status = 404;
    throw error;
  }

  if (item.estado !== 'regularizable' || !item.regularizacion) {
    const error = new Error('Este cierre no tiene evidencia fuerte suficiente para regularización automática');
    error.status = 409;
    throw error;
  }

  const { data: pagoExistente, error: existenteError } = await cliente
    .from('cierre_pagos')
    .select('id')
    .eq('cierre_id', item.id)
    .ilike('notas', `%${item.regularizacion.marcador}%`)
    .maybeSingle();

  if (existenteError) throw existenteError;
  if (pagoExistente) {
    const error = new Error('Ya existe una regularización histórica para esta evidencia');
    error.status = 409;
    throw error;
  }

  const notas = [
    item.regularizacion.marcador,
    'Regularización histórica creada desde Centro de Inteligencia · Conciliación de cierres',
    `Origen: ${item.regularizacion.origen}`,
    `Evidencia: ${item.evidencia?.descripcion || 'evidencia fuerte'}`,
    `Diferencia regularizada: ${item.diferencia}`,
    `Usuario: ${user.email || user.id}`,
  ].filter(Boolean).join(' · ');

  const { error: insertError } = await cliente.from('cierre_pagos').insert({
    cierre_id: item.id,
    concepto: 'regularizacion_historica',
    monto: item.regularizacion.monto,
    fecha: item.regularizacion.fecha,
    metodo_pago: item.regularizacion.metodo_pago,
    notas,
  });

  if (insertError) throw insertError;

  const { data: pagosActualizados, error: pagosError } = await cliente
    .from('cierre_pagos')
    .select('monto')
    .eq('cierre_id', item.id);

  if (pagosError) throw pagosError;

  const totalPagos = sumarMontos(pagosActualizados || []);
  const pendiente = redondearMoneda(Math.max(0, item.comision - totalPagos));

  const { error: updateError } = await cliente
    .from('cierres')
    .update({
      cobrado: totalPagos,
      pendiente,
      cobrado_bool: totalPagos >= item.comision && item.comision > 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', item.id);

  if (updateError) throw updateError;

  if (item.recibo_id) {
    await cliente.from('recibos_log').insert({
      recibo_id: item.recibo_id,
      accion: 'regularizacion_historica_cierre',
      usuario_id: user.id || null,
    }).then(({ error }) => {
      if (error && !errorTablaNoExiste(error)) throw error;
    });
  }

  return {
    cierre_id: item.id,
    pago_creado: {
      concepto: 'regularizacion_historica',
      monto: item.regularizacion.monto,
      fecha: item.regularizacion.fecha,
      metodo_pago: item.regularizacion.metodo_pago,
      notas,
    },
    resumen_actualizado: {
      cobrado: totalPagos,
      pendiente,
      cobrado_bool: totalPagos >= item.comision && item.comision > 0,
      conciliado: dineroIgual(totalPagos, item.cobrado_sistema),
    },
  };
}

async function ignorarCierre({ cierreId, motivo, user, cliente = supabase }) {
  const { disponibles } = await cargarIgnorados(cliente);
  if (!disponibles) {
    const error = new Error(`Falta crear la tabla ${TABLA_IGNORADOS} para persistir casos ignorados`);
    error.status = 409;
    throw error;
  }

  const { error } = await cliente.from(TABLA_IGNORADOS).upsert({
    modulo: 'cierres',
    entidad_tipo: 'cierre',
    entidad_id: String(cierreId),
    motivo: motivo || 'Ignorado manualmente desde conciliación de cierres',
    created_by: user.id || null,
    updated_at: new Date().toISOString(),
  }, {
    onConflict: 'modulo,entidad_tipo,entidad_id',
  });

  if (error) throw error;
  return { cierre_id: cierreId, estado: 'ignorado' };
}

async function ejecutarAccion(req, res, auth, cliente = supabase) {
  const { action, cierre_id: cierreId, motivo } = req.body || {};

  if (!cierreId) return res.status(400).json({ ok: false, error: 'Falta cierre_id' });

  if (action === 'regularizar') {
    const result = await regularizarCierre({ cierreId, user: { ...auth.user, email: auth.perfil.email }, cliente });
    return res.status(200).json({ ok: true, action, result });
  }

  if (action === 'ignorar') {
    const result = await ignorarCierre({ cierreId, motivo, user: auth.user, cliente });
    return res.status(200).json({ ok: true, action, result });
  }

  return res.status(400).json({ ok: false, error: 'Acción no soportada' });
}

export default async function handler(req, res) {
  try {
    if (!supabase) {
      return res.status(500).json({ ok: false, error: 'Falta configuración de Supabase para conciliación' });
    }

    const token = obtenerToken(req);
    const cliente = crearClienteSupabase(token) || supabase;
    const auth = await autenticarDireccion(req, cliente);
    if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });

    if (req.method === 'GET') return listarConciliacion(req, res, cliente);
    if (req.method === 'POST') return ejecutarAccion(req, res, auth, cliente);
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || 'Error en conciliación de cierres',
    });
  }
}
