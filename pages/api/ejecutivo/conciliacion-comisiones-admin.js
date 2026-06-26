import { createClient } from '@supabase/supabase-js';
import {
  clasificarComisionAdmin,
  dineroIgual,
  redondearMoneda,
} from '../../../lib/ejecutivo/conciliacionComisionesAdmin';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServerKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseServerKey
  ? createClient(supabaseUrl, supabaseServerKey)
  : null;

const ROLES_BI = new Set(['admin', 'direccion']);
const EMAILS_DIRECCION = new Set(['carlos.nachon@emporioinmobiliario.mx']);

function obtenerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function crearClienteSupabase(token) {
  if (!supabaseUrl || !supabaseServerKey) return null;
  return createClient(supabaseUrl, supabaseServerKey, token ? {
    global: { headers: { Authorization: `Bearer ${token}` } },
  } : undefined);
}

async function autenticarDireccion(req, cliente = supabase) {
  if (!cliente) return { error: 'Falta configuración de Supabase', status: 500 };

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
  const autorizado = ROLES_BI.has(perfil?.role_id) || EMAILS_DIRECCION.has(email);
  if (!autorizado) return { error: 'No tienes permiso para conciliación ejecutiva', status: 403 };

  return { user, perfil: { ...perfil, email } };
}

function periodoBounds(periodo) {
  if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return null;
  const [year, month] = periodo.split('-').map(Number);
  const start = `${periodo}-01`;
  const next = new Date(year, month, 1);
  const endExclusive = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  return { start, endExclusive };
}

async function cargarItemComision(comisionId, cliente = supabase) {
  const { data: comision, error: comisionError } = await cliente
    .from('comisiones_admin')
    .select('id, contract_id, periodo, monto, tipo, status, fecha_cobro, notas, created_by, created_at')
    .eq('id', comisionId)
    .maybeSingle();

  if (comisionError) throw comisionError;
  if (!comision) return null;

  const { data: contract, error: contractError } = await cliente
    .from('contracts')
    .select('id, property_id, tenant_name, property_name, owner_name, status, rent_receiver, commission_type, commission_value, monthly_rent')
    .eq('id', comision.contract_id)
    .maybeSingle();

  if (contractError) throw contractError;
  if (!contract) return { comision, contract: null, property: null, payments: [], ownerPayments: [], cashMovements: [] };

  let property = null;
  if (contract.property_id) {
    const { data, error } = await cliente
      .from('properties')
      .select('id, name, owner_email, owner_phone, rent_amount')
      .eq('id', contract.property_id)
      .maybeSingle();
    if (error) throw error;
    property = data || null;
  }

  if (!property && contract.property_name) {
    const { data, error } = await cliente
      .from('properties')
      .select('id, name, owner_email, owner_phone, rent_amount')
      .eq('name', contract.property_name)
      .maybeSingle();
    if (error) throw error;
    property = data || null;
  }

  const bounds = periodoBounds(comision.periodo);
  const { data: payments, error: paymentsError } = await cliente
    .from('payments')
    .select('id, contract_id, period_month, period_year, amount, due_date, payment_date, status, recibido_por, tenant_name, property_name')
    .eq('contract_id', contract.id);
  if (paymentsError) throw paymentsError;

  let ownerPayments = [];
  if (property?.owner_email) {
    const { data, error } = await cliente
      .from('owner_payments')
      .select('id, owner_name, owner_email, period_description, properties, total_rent, total_commission, total_liquid, amount_paid, payment_method, payment_date, status, notes, rent_receiver, created_at')
      .eq('owner_email', property.owner_email);
    if (error) throw error;
    ownerPayments = data || [];
  }

  let cashMovements = [];
  if (bounds) {
    const { data, error } = await cliente
      .from('cash_movements')
      .select('id, type, category, description, amount, payment_method, date, notes, created_by, created_at')
      .gte('date', bounds.start)
      .lt('date', bounds.endExclusive);
    if (error) throw error;
    cashMovements = data || [];
  }

  return { comision, contract, property, payments: payments || [], ownerPayments, cashMovements };
}

async function regularizarComision({ comisionId, user, cliente = supabase }) {
  const itemData = await cargarItemComision(comisionId, cliente);
  if (!itemData?.comision) {
    const error = new Error('Comisión no encontrada');
    error.status = 404;
    throw error;
  }

  const clasificacion = clasificarComisionAdmin(itemData);
  if (clasificacion.estado !== 'regularizable' || !clasificacion.regularizacion) {
    const error = new Error('Esta comisión no tiene evidencia fuerte suficiente para regularizar');
    error.status = 409;
    throw error;
  }

  const { comision, contract, property } = itemData;
  const { liquidacion, caja, pagoRenta } = clasificacion.evidencia || {};
  const fechaCobro = clasificacion.regularizacion.fecha_cobro;
  const montoComision = redondearMoneda(comision.monto || clasificacion.regularizacion.monto);
  const usuario = user.email || user.id;

  const notasComision = [
    comision.notas || null,
    `Regularizada desde Centro de Inteligencia · evidencia liquidación:${liquidacion?.id || '—'} · usuario:${usuario}`,
  ].filter(Boolean).join(' · ');

  const { error: updateError } = await cliente
    .from('comisiones_admin')
    .update({
      status: 'cobrada',
      fecha_cobro: fechaCobro,
      notas: notasComision,
    })
    .eq('id', comision.id)
    .eq('status', 'pendiente');

  if (updateError) throw updateError;

  const movimientos = [];
  const ownerName = contract?.owner_name || liquidacion?.owner_name || 'Propietario';
  const periodo = liquidacion?.period_description || comision.periodo;
  const paymentMethod = liquidacion?.payment_method || 'transferencia';

  if (!caja?.salidaLiquidacion && liquidacion?.amount_paid) {
    const payload = {
      type: 'salida',
      category: 'liquidacion_propietario',
      description: `Liquidación ${ownerName} - ${periodo}`,
      amount: liquidacion.amount_paid,
      payment_method: paymentMethod,
      date: liquidacion.payment_date || fechaCobro,
      notes: `Regularización trazabilidad BI · owner_payment:${liquidacion.id} · Propiedad: ${contract?.property_name || property?.name || '—'} · Comisión retenida: ${montoComision}`,
      created_by: usuario,
      created_at: new Date().toISOString(),
    };
    const { error } = await cliente.from('cash_movements').insert([payload]);
    if (error) throw error;
    movimientos.push({ tipo: 'salida_liquidacion_propietario', ...payload });
  }

  if (!caja?.entradaComision && montoComision > 0) {
    const payload = {
      type: 'entrada',
      category: 'comision_cobrada',
      description: `Comisión administración ${ownerName} - ${periodo}`,
      amount: montoComision,
      payment_method: paymentMethod,
      date: fechaCobro,
      notes: `Regularización BI · comisiones_admin:${comision.id} · ${liquidacion?.id ? `owner_payment:${liquidacion.id}` : ''} · ${pagoRenta?.id ? `payment:${pagoRenta.id}` : ''}`,
      created_by: usuario,
      created_at: new Date().toISOString(),
    };
    const { error } = await cliente.from('cash_movements').insert([payload]);
    if (error) throw error;
    movimientos.push({ tipo: 'entrada_comision_cobrada', ...payload });
  }

  return {
    comision_id: comision.id,
    status: 'cobrada',
    fecha_cobro: fechaCobro,
    movimientos_creados: movimientos,
    movimientos_validados: {
      salida_liquidacion_existia: Boolean(caja?.salidaLiquidacion),
      entrada_comision_existia: Boolean(caja?.entradaComision),
    },
    conciliado: dineroIgual(montoComision, comision.monto),
  };
}

export default async function handler(req, res) {
  try {
    if (!supabase) return res.status(500).json({ ok: false, error: 'Falta configuración de Supabase' });

    const token = obtenerToken(req);
    const cliente = crearClienteSupabase(token) || supabase;
    const auth = await autenticarDireccion(req, cliente);
    if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });

    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

    const { action, comision_id: comisionId } = req.body || {};
    if (action !== 'regularizar') return res.status(400).json({ ok: false, error: 'Acción no soportada' });
    if (!comisionId) return res.status(400).json({ ok: false, error: 'Falta comision_id' });

    const result = await regularizarComision({ comisionId, user: { ...auth.user, email: auth.perfil.email }, cliente });
    return res.status(200).json({ ok: true, action, result });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || 'Error en conciliación de comisiones de administración',
    });
  }
}
