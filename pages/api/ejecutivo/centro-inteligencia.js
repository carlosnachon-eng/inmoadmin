import { createClient } from '@supabase/supabase-js';
import {
  roundMoney,
  resolverPeriodo,
  resumirAdministracion,
  resumirCierres,
  toNumber,
} from '../../../lib/ejecutivo/lecturaBiCierresAdmin';
import {
  construirDiagnosticoCaja,
  construirCentroInteligencia,
  resumirMantenimientoCentro,
  resumirPolizaCentro,
  unidadDesdeLecturaBi,
} from '../../../lib/ejecutivo/centroInteligencia';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ROLES_BI = new Set(['admin', 'direccion']);
const EMAILS_DIRECCION = new Set([
  'carlos.nachon@emporioinmobiliario.mx',
]);

async function autenticarDireccion(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { error: 'Sesión requerida', status: 401 };

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { error: 'Sesión inválida', status: 401 };

  const { data: perfil, error: perfilError } = await supabase
    .from('profiles')
    .select('id, full_name, email, role_id')
    .eq('id', user.id)
    .maybeSingle();

  if (perfilError) return { error: perfilError.message, status: 500 };

  const email = (perfil?.email || user.email || '').toLowerCase();
  const role = perfil?.role_id || null;
  const autorizado = ROLES_BI.has(role) || EMAILS_DIRECCION.has(email);

  if (!autorizado) {
    return { error: 'No tienes permiso para consultar Centro de Inteligencia', status: 403 };
  }

  return { user, perfil: { ...perfil, email } };
}

async function cargarCierres(periodo) {
  const { data: cierres, error: cierresError } = await supabase
    .from('cierres')
    .select('id, fecha_cierre, operacion, precio, comision, cobrado, pendiente, cobrado_bool, vendedor, propiedad_id, recibo_id, firma_id, comision_inmobiliaria, monto_gerente')
    .gte('fecha_cierre', periodo.startDate)
    .lt('fecha_cierre', periodo.endExclusive)
    .order('fecha_cierre', { ascending: true });

  if (cierresError) throw cierresError;

  const { data: pagosPeriodo, error: pagosPeriodoError } = await supabase
    .from('cierre_pagos')
    .select('id, cierre_id, concepto, monto, fecha, notas')
    .gte('fecha', periodo.startDate)
    .lt('fecha', periodo.endExclusive)
    .order('fecha', { ascending: true });

  if (pagosPeriodoError) throw pagosPeriodoError;

  const cierreIds = (cierres || []).map((cierre) => cierre.id).filter(Boolean);
  let pagosConciliacion = [];

  if (cierreIds.length > 0) {
    const { data, error } = await supabase
      .from('cierre_pagos')
      .select('id, cierre_id, concepto, monto, fecha, notas')
      .in('cierre_id', cierreIds);

    if (error) throw error;
    pagosConciliacion = data || [];
  }

  return {
    cierres: cierres || [],
    pagosPeriodo: pagosPeriodo || [],
    pagosConciliacion,
  };
}

async function cargarAdministracion(periodo) {
  const { data: comisionesPeriodo, error: periodoError } = await supabase
    .from('comisiones_admin')
    .select('id, contract_id, periodo, monto, tipo, status, fecha_cobro')
    .eq('periodo', periodo.periodKey)
    .order('periodo', { ascending: true });

  if (periodoError) throw periodoError;

  const { data: comisionesCobradasPeriodo, error: cobroError } = await supabase
    .from('comisiones_admin')
    .select('id, contract_id, periodo, monto, tipo, status, fecha_cobro')
    .eq('status', 'cobrada')
    .gte('fecha_cobro', periodo.startDate)
    .lt('fecha_cobro', periodo.endExclusive)
    .order('fecha_cobro', { ascending: true });

  if (cobroError) throw cobroError;

  return {
    comisionesPeriodo: comisionesPeriodo || [],
    comisionesCobradasPeriodo: comisionesCobradasPeriodo || [],
  };
}

async function cargarPoliza() {
  const [expedientesRes, cajaRes, solicitudesRes] = await Promise.all([
    supabase.from('poliza_expedientes').select('*').order('created_at', { ascending: false }),
    supabase.from('poliza_caja').select('*').order('fecha', { ascending: false }),
    supabase.from('solicitudes_inquilino').select('*').order('created_at', { ascending: false }),
  ]);

  if (expedientesRes.error) throw expedientesRes.error;
  if (cajaRes.error) throw cajaRes.error;
  if (solicitudesRes.error) throw solicitudesRes.error;

  return {
    expedientes: expedientesRes.data || [],
    caja: cajaRes.data || [],
    solicitudes: solicitudesRes.data || [],
  };
}

async function cargarMantenimiento() {
  const [ticketsRes, quotesRes, cashRes, propertiesRes, contractsRes] = await Promise.all([
    supabase.from('maintenance_tickets').select('*').order('created_at', { ascending: false }),
    supabase.from('maintenance_quotes').select('*').order('created_at', { ascending: false }),
    supabase.from('cash_movements').select('*').in('category', ['mantenimiento_cobrado', 'anticipo_mantenimiento', 'pago_proveedor']).order('created_at', { ascending: false }),
    supabase.from('properties').select('*').order('name', { ascending: true }),
    supabase.from('contracts').select('*').eq('status', 'activo').order('created_at', { ascending: false }),
  ]);

  if (ticketsRes.error) throw ticketsRes.error;
  if (quotesRes.error) throw quotesRes.error;
  if (cashRes.error) throw cashRes.error;
  if (propertiesRes.error) throw propertiesRes.error;
  if (contractsRes.error) throw contractsRes.error;

  return {
    tickets: ticketsRes.data || [],
    quotes: quotesRes.data || [],
    cashMovements: cashRes.data || [],
    properties: propertiesRes.data || [],
    contracts: contractsRes.data || [],
  };
}

async function cargarCajaPeriodo(periodo) {
  const [cashRes, polizaRes] = await Promise.all([
    supabase
      .from('cash_movements')
      .select('id, type, category, description, amount, payment_method, date, notes, created_by, created_at, reference_id, reference_type')
      .gte('date', periodo.startDate)
      .lt('date', periodo.endExclusive)
      .order('date', { ascending: true }),
    supabase
      .from('poliza_caja')
      .select('*')
      .gte('fecha', periodo.startDate)
      .lt('fecha', periodo.endExclusive)
      .order('fecha', { ascending: true }),
  ]);

  if (cashRes.error) throw cashRes.error;
  if (polizaRes.error) throw polizaRes.error;

  return {
    cashMovements: cashRes.data || [],
    polizaCaja: polizaRes.data || [],
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: 'Falta configuración de Supabase para Centro de Inteligencia' });
  }

  const auth = await autenticarDireccion(req);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });

  let periodo;
  try {
    periodo = resolverPeriodo(req.query || {});
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }

  try {
    const [datosCierres, datosAdmin, datosPoliza, datosMantenimiento, datosCaja] = await Promise.all([
      cargarCierres(periodo),
      cargarAdministracion(periodo),
      cargarPoliza(),
      cargarMantenimiento(),
      cargarCajaPeriodo(periodo),
    ]);

    const resumenCierres = resumirCierres(datosCierres);
    const resumenAdmin = resumirAdministracion(datosAdmin);
    const resumenPoliza = resumirPolizaCentro({ periodo, ...datosPoliza });
    const resumenMantenimiento = resumirMantenimientoCentro({ periodo, ...datosMantenimiento });
    const resultadoCierres = roundMoney(
      (datosCierres.cierres || []).reduce((acc, cierre) => (
        acc + Math.max(0, toNumber(cierre.comision_inmobiliaria) - toNumber(cierre.monto_gerente))
      ), 0),
    );
    const costosCierres = roundMoney(
      (datosCierres.cierres || []).reduce((acc, cierre) => (
        acc + Math.max(0, toNumber(cierre.comision) - toNumber(cierre.comision_inmobiliaria)) + toNumber(cierre.monto_gerente)
      ), 0),
    );

    const centroBase = construirCentroInteligencia({
      periodo,
      cierres: unidadDesdeLecturaBi({
        key: 'cierres',
        label: 'Ventas y rentas',
        unidad: resumenCierres,
        resultado: resultadoCierres,
        costosDirectos: costosCierres,
      }),
      administracion: unidadDesdeLecturaBi({
        key: 'administracion',
        label: 'Administración',
        unidad: resumenAdmin,
        resultado: resumenAdmin.metricas.cobrado,
        costosDirectos: 0,
      }),
      poliza: resumenPoliza,
      mantenimiento: resumenMantenimiento,
    });
    const diagnosticoCaja = construirDiagnosticoCaja({
      periodo,
      cashMovements: datosCaja.cashMovements,
      polizaCaja: datosCaja.polizaCaja,
      resultadoOperativo: centroBase.resumen_general.resultado_operativo,
    });
    const centro = {
      ...centroBase,
      caja_vs_resultado: diagnosticoCaja,
    };

    return res.status(200).json({
      ok: true,
      generated_at: new Date().toISOString(),
      generated_by: {
        user_id: auth.user.id,
        email: auth.perfil.email,
        role_id: auth.perfil.role_id,
      },
      ...centro,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Error al construir Centro de Inteligencia',
    });
  }
}
