import { createClient } from '@supabase/supabase-js';
import {
  combinarResumenBi,
  mapearEventosAdministracion,
  mapearEventosCierres,
  resolverPeriodo,
  resumirAdministracion,
  resumirCierres,
} from '../../../lib/ejecutivo/lecturaBiCierresAdmin';

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
    return { error: 'No tienes permiso para consultar lectura BI', status: 403 };
  }

  return { user, perfil: { ...perfil, email } };
}

async function cargarCierres(periodo) {
  const { data: cierres, error: cierresError } = await supabase
    .from('cierres')
    .select('id, fecha_cierre, operacion, precio, comision, cobrado, pendiente, cobrado_bool, vendedor, propiedad_id, recibo_id, firma_id')
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

  const cierreIds = (cierres || []).map((c) => c.id).filter(Boolean);
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: 'Falta configuración de Supabase para lectura BI' });
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
    const [datosCierres, datosAdmin] = await Promise.all([
      cargarCierres(periodo),
      cargarAdministracion(periodo),
    ]);

    const resumenCierres = resumirCierres(datosCierres);
    const resumenAdmin = resumirAdministracion(datosAdmin);
    const resumen = combinarResumenBi({
      periodo,
      cierres: resumenCierres,
      administracion: resumenAdmin,
    });

    const incluirEventos = req.query?.include === 'events';

    return res.status(200).json({
      ok: true,
      generated_at: new Date().toISOString(),
      generated_by: {
        user_id: auth.user.id,
        email: auth.perfil.email,
        role_id: auth.perfil.role_id,
      },
      ...resumen,
      eventos: incluirEventos
        ? {
          cierres: mapearEventosCierres({
            cierres: datosCierres.cierres,
            pagos: datosCierres.pagosPeriodo,
          }),
          administracion: mapearEventosAdministracion({
            comisionesGeneradas: datosAdmin.comisionesPeriodo,
            comisionesCobradas: datosAdmin.comisionesCobradasPeriodo,
          }),
        }
        : undefined,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Error al construir lectura BI',
    });
  }
}
