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
  construirProyeccionAnual,
  resumirMantenimientoCentro,
  resumirPolizaCentro,
  unidadDesdeLecturaBi,
} from '../../../lib/ejecutivo/centroInteligencia';
import { construirCentroExcepciones } from '../../../lib/ejecutivo/excepcionesCentro';
import {
  cargarMantenimientoPeriodo,
  cargarPolizaPeriodo,
} from '../../../lib/ejecutivo/dataLoaders';
import { createQueryMetrics } from '../../../lib/ejecutivo/queryMetrics';

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

async function cargarCierres(periodo, metrics) {
  const measure = metrics?.measure?.bind(metrics) || ((label, promiseFactory) => promiseFactory());

  const { data: cierres, error: cierresError } = await measure('cierres.periodo', () => supabase
    .from('cierres')
    .select('id, fecha_cierre, operacion, precio, comision, cobrado, pendiente, cobrado_bool, vendedor, propiedad_id, recibo_id, firma_id, comision_inmobiliaria, monto_gerente')
    .gte('fecha_cierre', periodo.startDate)
    .lt('fecha_cierre', periodo.endExclusive)
    .order('fecha_cierre', { ascending: true }));

  if (cierresError) throw cierresError;

  const { data: pagosPeriodo, error: pagosPeriodoError } = await measure('cierre_pagos.periodo', () => supabase
    .from('cierre_pagos')
    .select('id, cierre_id, concepto, monto, fecha, notas')
    .gte('fecha', periodo.startDate)
    .lt('fecha', periodo.endExclusive)
    .order('fecha', { ascending: true }));

  if (pagosPeriodoError) throw pagosPeriodoError;

  const cierreIds = (cierres || []).map((cierre) => cierre.id).filter(Boolean);
  let pagosConciliacion = [];

  if (cierreIds.length > 0) {
    const { data, error } = await measure('cierre_pagos.cierres_periodo', () => supabase
      .from('cierre_pagos')
      .select('id, cierre_id, concepto, monto, fecha, notas')
      .in('cierre_id', cierreIds));

    if (error) throw error;
    pagosConciliacion = data || [];
  }

  return {
    cierres: cierres || [],
    pagosPeriodo: pagosPeriodo || [],
    pagosConciliacion,
  };
}

async function cargarAdministracion(periodo, metrics) {
  const measure = metrics?.measure?.bind(metrics) || ((label, promiseFactory) => promiseFactory());

  const { data: comisionesPeriodo, error: periodoError } = await measure('comisiones_admin.periodo', () => supabase
    .from('comisiones_admin')
    .select('id, contract_id, periodo, monto, tipo, status, fecha_cobro')
    .eq('periodo', periodo.periodKey)
    .order('periodo', { ascending: true }));

  if (periodoError) throw periodoError;

  const { data: comisionesCobradasPeriodo, error: cobroError } = await measure('comisiones_admin.cobradas_periodo', () => supabase
    .from('comisiones_admin')
    .select('id, contract_id, periodo, monto, tipo, status, fecha_cobro')
    .eq('status', 'cobrada')
    .gte('fecha_cobro', periodo.startDate)
    .lt('fecha_cobro', periodo.endExclusive)
    .order('fecha_cobro', { ascending: true }));

  if (cobroError) throw cobroError;

  return {
    comisionesPeriodo: comisionesPeriodo || [],
    comisionesCobradasPeriodo: comisionesCobradasPeriodo || [],
  };
}

async function cargarAdministracionAnual(periodo, metrics) {
  const measure = metrics?.measure?.bind(metrics) || ((label, promiseFactory) => promiseFactory());
  const desdePeriodo = `${periodo.year}-01`;
  const hastaPeriodo = periodo.endDate.slice(0, 7);

  const { data: comisionesPeriodo, error: periodoError } = await measure('comisiones_admin.ytd', () => supabase
    .from('comisiones_admin')
    .select('id, contract_id, periodo, monto, tipo, status, fecha_cobro')
    .gte('periodo', desdePeriodo)
    .lte('periodo', hastaPeriodo)
    .order('periodo', { ascending: true }));

  if (periodoError) throw periodoError;

  const { data: comisionesCobradasPeriodo, error: cobroError } = await measure('comisiones_admin.cobradas_ytd', () => supabase
    .from('comisiones_admin')
    .select('id, contract_id, periodo, monto, tipo, status, fecha_cobro')
    .eq('status', 'cobrada')
    .gte('fecha_cobro', periodo.startDate)
    .lt('fecha_cobro', periodo.endExclusive)
    .order('fecha_cobro', { ascending: true }));

  if (cobroError) throw cobroError;

  return {
    comisionesPeriodo: comisionesPeriodo || [],
    comisionesCobradasPeriodo: comisionesCobradasPeriodo || [],
  };
}

async function cargarCajaPeriodo(periodo, metrics) {
  const measure = metrics?.measure?.bind(metrics) || ((label, promiseFactory) => promiseFactory());

  const cashRes = await measure('cash_movements.caja_periodo', () => supabase
      .from('cash_movements')
      .select('id, type, category, description, amount, payment_method, date, notes, created_by, created_at, reference_id, reference_type')
      .gte('date', periodo.startDate)
      .lt('date', periodo.endExclusive)
      .order('date', { ascending: true }));

  if (cashRes.error) throw cashRes.error;

  return {
    cashMovements: cashRes.data || [],
  };
}

async function cargarDatosOperativos(metrics) {
  const measure = metrics?.measure?.bind(metrics) || ((label, promiseFactory) => promiseFactory());
  const fuentesConError = [];
  const safe = async (label, promiseFactory) => {
    try {
      const { data, error } = await measure(label, promiseFactory);
      if (error) {
        fuentesConError.push({ fuente: label, error: error.message });
        return [];
      }
      return data || [];
    } catch (error) {
      fuentesConError.push({ fuente: label, error: error.message });
      return [];
    }
  };

  const hoy = new Date();
  const hace90 = new Date(hoy);
  hace90.setDate(hoy.getDate() - 90);
  const hace90Iso = hace90.toISOString();
  const en45 = new Date(hoy);
  en45.setDate(hoy.getDate() + 45);
  const en45Date = en45.toISOString().slice(0, 10);

  const [
    pagos,
    contratos,
    mantenimientos,
    citas,
    clientes,
    seguimientos,
    propiedades,
    visitasPropiedad,
    contactosPropiedad,
    enviosPropiedades,
    recibos,
    firmas,
    citasFirma,
    cierres,
    cierrePagos,
    solicitudes,
    partnerOperations,
  ] = await Promise.all([
    safe('operativo.payments', () => supabase
      .from('payments')
      .select('id, tenant_name, property_name, amount, due_date, status, created_at')
      .in('status', ['pendiente', 'atrasado'])
      .order('due_date', { ascending: true })),
    safe('operativo.contracts', () => supabase
      .from('contracts')
      .select('id, tenant_name, property_name, owner_name, end_date, status')
      .eq('status', 'activo')
      .lte('end_date', en45Date)
      .order('end_date', { ascending: true })),
    safe('operativo.maintenance_tickets', () => supabase
      .from('maintenance_tickets')
      .select('id, property_name, tenant_name, title, priority, status, created_at, updated_at')
      .not('status', 'in', '("cerrado","cancelado","resuelto")')
      .order('updated_at', { ascending: true })),
    safe('operativo.citas', () => supabase
      .from('citas')
      .select('id, cliente_id, propiedad_id, fecha_hora, estado, asesor_id, clientes(nombre), profiles:asesor_id(full_name, email)')
      .gte('fecha_hora', hace90Iso)
      .order('fecha_hora', { ascending: true })),
    safe('operativo.clientes', () => supabase
      .from('clientes')
      .select('id, nombre, etapa_interes, asesor_id, created_at, updated_at, profiles:asesor_id(full_name, email)')
      .not('etapa_interes', 'in', '("perdido","cerrado")')
      .order('updated_at', { ascending: true })),
    safe('operativo.seguimientos_cliente', () => supabase
      .from('seguimientos_cliente')
      .select('id, cliente_id, asesor_id, created_at')
      .gte('created_at', hace90Iso)
      .order('created_at', { ascending: false })),
    safe('operativo.propiedades', () => supabase
      .from('propiedades')
      .select('id, titulo, status, fotos, created_at, updated_at, apartado_fecha, apartado_monto, apartado_vigencia_hasta')
      .in('status', ['published', 'reserved'])
      .order('updated_at', { ascending: true })),
    safe('operativo.visitas_propiedad', () => supabase
      .from('visitas_propiedad')
      .select('id, propiedad_id, created_at')
      .gte('created_at', hace90Iso)),
    safe('operativo.solicitudes_contacto_propiedad', () => supabase
      .from('solicitudes_contacto_propiedad')
      .select('id, propiedad_id, created_at')
      .gte('created_at', hace90Iso)),
    safe('operativo.envios_propiedades', () => supabase
      .from('envios_propiedades')
      .select('propiedad_id, envios(created_at)')),
    safe('operativo.recibos_apartado', () => supabase
      .from('recibos_apartado')
      .select('id, folio, tipo, cliente_nombre, inmueble, propiedad_id, firma_id, estatus, monto, monto_total_acordado, apartado_vigencia_hasta, fecha_limite_firma, created_at, updated_at, recibos_abonos(id, monto, fecha, created_at)')
      .neq('estatus', 'cancelado')
      .order('created_at', { ascending: false })),
    safe('operativo.firmas', () => supabase
      .from('firmas')
      .select('id, titulo, tipo, nombre_comprador, propiedad_id, recibo_id, status, etapa_actual, created_at, updated_at, firma_etapas(id, orden, clave, nombre, status, responsable, updated_at)')
      .in('status', ['activo', 'completado'])
      .order('updated_at', { ascending: true })),
    safe('operativo.firmas_citas', () => supabase
      .from('firmas_citas')
      .select('id, firma_id, titulo, fecha, hora')
      .order('fecha', { ascending: true })),
    safe('operativo.cierres', () => supabase
      .from('cierres')
      .select('id, propiedad, operacion, fecha_cierre, comision, cobrado, pendiente, cobrado_bool, recibo_id, firma_id, propiedad_id')
      .order('fecha_cierre', { ascending: false })),
    safe('operativo.cierre_pagos', () => supabase
      .from('cierre_pagos')
      .select('id, cierre_id, concepto, monto, fecha, notas')
      .order('fecha', { ascending: false })),
    safe('operativo.solicitudes_inquilino', () => supabase
      .from('solicitudes_inquilino')
      .select('id, nombre_completo, razon_social, status, created_at, updated_at, ia_revision_manual, ia_analisis_documental')
      .order('updated_at', { ascending: true })),
    safe('operativo.partner_operations', () => supabase
      .from('partner_operations')
      .select('id, folio, status_partner, nombre_propietario, nombre_inquilino, direccion_inmueble, monto_renta, commission_estimated, commission_generated, commission_paid, solicitud_inquilino_id, propietario_id, poliza_expediente_id, created_at, updated_at')
      .order('updated_at', { ascending: true })),
  ]);

  return {
    fuentesConError,
    pagos,
    contratos,
    mantenimientos,
    citas,
    clientes,
    seguimientos,
    propiedades,
    visitasPropiedad,
    contactosPropiedad,
    enviosPropiedades,
    recibos,
    firmas,
    citasFirma,
    cierres,
    cierrePagos,
    solicitudes,
    partnerOperations,
  };
}

const resolverPeriodoAnual = (periodo) => {
  const hoy = new Date();
  const selectedYear = Number(periodo.year || hoy.getFullYear());
  const currentYear = hoy.getFullYear();
  const corte = selectedYear === currentYear
    ? hoy.toISOString().slice(0, 10)
    : `${selectedYear}-12-31`;
  return resolverPeriodo({
    start: `${selectedYear}-01-01`,
    end: corte,
  });
};

const construirUnidadFinanciera = ({ periodo, datosCierres, datosAdmin, datosPoliza, datosMantenimiento }) => {
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

  return construirCentroInteligencia({
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
};

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
    const metrics = createQueryMetrics();
    const periodoAnual = resolverPeriodoAnual(periodo);
    const [datosCierres, datosAdmin, datosPoliza, datosMantenimiento, datosCaja, datosOperativos] = await Promise.all([
      cargarCierres(periodo, metrics),
      cargarAdministracion(periodo, metrics),
      cargarPolizaPeriodo(supabase, periodo, metrics),
      cargarMantenimientoPeriodo(supabase, periodo, metrics),
      cargarCajaPeriodo(periodo, metrics),
      cargarDatosOperativos(metrics),
    ]);

    const centroBase = construirUnidadFinanciera({
      periodo,
      datosCierres,
      datosAdmin,
      datosPoliza,
      datosMantenimiento,
    });

    const [datosCierresAnual, datosAdminAnual, datosPolizaAnual, datosMantenimientoAnual] = await Promise.all([
      cargarCierres(periodoAnual, metrics),
      cargarAdministracionAnual(periodoAnual, metrics),
      cargarPolizaPeriodo(supabase, periodoAnual, metrics),
      cargarMantenimientoPeriodo(supabase, periodoAnual, metrics),
    ]);
    const centroAnual = construirUnidadFinanciera({
      periodo: periodoAnual,
      datosCierres: datosCierresAnual,
      datosAdmin: datosAdminAnual,
      datosPoliza: datosPolizaAnual,
      datosMantenimiento: datosMantenimientoAnual,
    });
    const proyeccionAnual = construirProyeccionAnual({
      periodoAnual,
      resumenAnual: centroAnual.resumen_general,
      resumenPeriodo: centroBase.resumen_general,
      datosOperativos,
    });

    const diagnosticoCaja = construirDiagnosticoCaja({
      periodo,
      cashMovements: datosCaja.cashMovements,
      polizaCaja: datosPoliza.caja,
      resultadoOperativo: centroBase.resumen_general.resultado_operativo,
    });
    const centro = {
      ...centroBase,
      caja_vs_resultado: diagnosticoCaja,
      proyeccion_anual: proyeccionAnual,
      excepciones: construirCentroExcepciones({
        ahora: new Date(),
        datos: datosOperativos,
        resumenCentro: centroBase,
      }),
      fuentes_excepciones_con_error: datosOperativos.fuentesConError || [],
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
      _performance: metrics.summary({
        optimized: true,
        notes: [
          'Póliza y mantenimiento se consultan por periodo desde el origen.',
          'Se eliminaron select(*) en los loaders del Centro de Inteligencia.',
          'poliza_caja del periodo se reutiliza para métricas y caja_vs_resultado.',
        ],
      }),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Error al construir Centro de Inteligencia',
    });
  }
}
