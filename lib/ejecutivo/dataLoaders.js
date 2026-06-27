const POLIZA_EXPEDIENTES_COLUMNS = [
  'id',
  'created_at',
  'fecha_firma',
  'fecha_inicio',
  'nombre_arrendatario',
  'direccion_inmueble',
  'inquilino_id',
  'status',
  'status_expediente',
  'monto_poliza',
  'anticipo_poliza',
  'anticipo_pagado',
  'saldo_pagado',
].join(', ');

const POLIZA_CAJA_COLUMNS = [
  'id',
  'created_at',
  'fecha',
  'tipo',
  'concepto',
  'monto',
  'descripcion',
  'expediente_id',
  'solicitud_id',
  'nombre_cliente',
].join(', ');

const SOLICITUDES_COLUMNS = [
  'id',
  'created_at',
  'nombre_completo',
  'razon_social',
  'inmueble_interes',
  'status',
  'cobro_investigacion',
  'monto_investigacion',
  'fecha_cobro_investigacion',
].join(', ');

const TICKETS_COLUMNS = [
  'id',
  'created_at',
  'updated_at',
  'title',
  'description',
  'property_name',
  'tenant_name',
  'payer',
  'status',
  'charged_amount',
  'provider_cost',
  'advance_amount',
  'advance_paid',
  'status_pago',
  'descontado_de_liquidacion',
  'fecha_cobro_propietario',
  'forma_cobro_propietario',
  'recibo_cobro_id',
].join(', ');

const QUOTES_COLUMNS = [
  'id',
  'ticket_id',
  'created_at',
  'updated_at',
  'status',
  'monto_final',
  'costo_proveedor',
].join(', ');

const CASH_MOVEMENTS_COLUMNS = [
  'id',
  'created_at',
  'date',
  'type',
  'category',
  'description',
  'amount',
  'notes',
  'reference_id',
  'reference_type',
].join(', ');

const PROPERTIES_COLUMNS = [
  'id',
  'name',
  'owner_email',
].join(', ');

const CONTRACTS_COLUMNS = [
  'id',
  'created_at',
  'status',
  'property_name',
  'owner_name',
  'tenant_name',
].join(', ');

const MAINTENANCE_CATEGORIES = ['mantenimiento_cobrado', 'anticipo_mantenimiento', 'pago_proveedor'];

function rangoPeriodoOr(periodo, fields) {
  return fields
    .map((field) => `and(${field}.gte.${periodo.startDate},${field}.lt.${periodo.endExclusive})`)
    .join(',');
}

function mergePorId(...grupos) {
  const map = new Map();
  grupos.flat().filter(Boolean).forEach((item) => {
    if (item?.id) map.set(String(item.id), item);
  });
  return Array.from(map.values());
}

export async function cargarPolizaConciliacion(supabase, metrics) {
  const measure = metrics?.measure?.bind(metrics) || ((label, promiseFactory) => promiseFactory());
  const [expedientesRes, cajaRes, solicitudesRes] = await Promise.all([
    measure('poliza_expedientes.conciliacion', () => supabase
      .from('poliza_expedientes')
      .select(POLIZA_EXPEDIENTES_COLUMNS)
      .order('created_at', { ascending: false })),
    measure('poliza_caja.conciliacion', () => supabase
      .from('poliza_caja')
      .select(POLIZA_CAJA_COLUMNS)
      .order('fecha', { ascending: false })),
    measure('solicitudes_inquilino.conciliacion', () => supabase
      .from('solicitudes_inquilino')
      .select(SOLICITUDES_COLUMNS)
      .order('created_at', { ascending: false })),
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

export async function cargarPolizaPeriodo(supabase, periodo, metrics) {
  const measure = metrics?.measure?.bind(metrics) || ((label, promiseFactory) => promiseFactory());
  const [expedientesPeriodoRes, cajaRes, solicitudesPeriodoRes] = await Promise.all([
    measure('poliza_expedientes.periodo', () => supabase
      .from('poliza_expedientes')
      .select(POLIZA_EXPEDIENTES_COLUMNS)
      .or(rangoPeriodoOr(periodo, ['fecha_firma', 'fecha_inicio']))
      .order('created_at', { ascending: false })),
    measure('poliza_caja.periodo', () => supabase
      .from('poliza_caja')
      .select(POLIZA_CAJA_COLUMNS)
      .gte('fecha', periodo.startDate)
      .lt('fecha', periodo.endExclusive)
      .order('fecha', { ascending: false })),
    measure('solicitudes_inquilino.periodo', () => supabase
      .from('solicitudes_inquilino')
      .select(SOLICITUDES_COLUMNS)
      .gte('fecha_cobro_investigacion', periodo.startDate)
      .lt('fecha_cobro_investigacion', periodo.endExclusive)
      .order('created_at', { ascending: false })),
  ]);

  if (expedientesPeriodoRes.error) throw expedientesPeriodoRes.error;
  if (cajaRes.error) throw cajaRes.error;
  if (solicitudesPeriodoRes.error) throw solicitudesPeriodoRes.error;

  const expedientesPeriodo = expedientesPeriodoRes.data || [];
  const solicitudesPeriodo = solicitudesPeriodoRes.data || [];
  const cajaPeriodo = cajaRes.data || [];

  const expedienteIdsPeriodo = new Set(expedientesPeriodo.map((item) => String(item.id)));
  const solicitudIdsPeriodo = new Set(solicitudesPeriodo.map((item) => String(item.id)));
  const expedienteIdsCaja = [...new Set(cajaPeriodo.map((mov) => mov.expediente_id).filter(Boolean).map(String))]
    .filter((id) => !expedienteIdsPeriodo.has(id));
  const solicitudIdsCaja = [...new Set(cajaPeriodo.map((mov) => mov.solicitud_id).filter(Boolean).map(String))]
    .filter((id) => !solicitudIdsPeriodo.has(id));

  const [expedientesCajaRes, solicitudesCajaRes] = await Promise.all([
    expedienteIdsCaja.length > 0
      ? measure('poliza_expedientes.vinculados_caja_periodo', () => supabase
        .from('poliza_expedientes')
        .select(POLIZA_EXPEDIENTES_COLUMNS)
        .in('id', expedienteIdsCaja))
      : Promise.resolve({ data: [] }),
    solicitudIdsCaja.length > 0
      ? measure('solicitudes_inquilino.vinculadas_caja_periodo', () => supabase
        .from('solicitudes_inquilino')
        .select(SOLICITUDES_COLUMNS)
        .in('id', solicitudIdsCaja))
      : Promise.resolve({ data: [] }),
  ]);

  if (expedientesCajaRes.error) throw expedientesCajaRes.error;
  if (solicitudesCajaRes.error) throw solicitudesCajaRes.error;

  return {
    expedientes: mergePorId(expedientesPeriodo, expedientesCajaRes.data || []),
    caja: cajaPeriodo,
    solicitudes: mergePorId(solicitudesPeriodo, solicitudesCajaRes.data || []),
  };
}

export async function cargarMantenimientoConciliacion(supabase, metrics) {
  const measure = metrics?.measure?.bind(metrics) || ((label, promiseFactory) => promiseFactory());
  const [ticketsRes, quotesRes, cashRes, propertiesRes, contractsRes] = await Promise.all([
    measure('maintenance_tickets.conciliacion', () => supabase
      .from('maintenance_tickets')
      .select(TICKETS_COLUMNS)
      .order('created_at', { ascending: false })),
    measure('maintenance_quotes.conciliacion', () => supabase
      .from('maintenance_quotes')
      .select(QUOTES_COLUMNS)
      .order('created_at', { ascending: false })),
    measure('cash_movements.mantenimiento.conciliacion', () => supabase
      .from('cash_movements')
      .select(CASH_MOVEMENTS_COLUMNS)
      .in('category', MAINTENANCE_CATEGORIES)
      .order('created_at', { ascending: false })),
    measure('properties.mantenimiento.conciliacion', () => supabase
      .from('properties')
      .select(PROPERTIES_COLUMNS)
      .order('name', { ascending: true })),
    measure('contracts.mantenimiento.conciliacion', () => supabase
      .from('contracts')
      .select(CONTRACTS_COLUMNS)
      .eq('status', 'activo')
      .order('created_at', { ascending: false })),
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

export async function cargarMantenimientoPeriodo(supabase, periodo, metrics) {
  const measure = metrics?.measure?.bind(metrics) || ((label, promiseFactory) => promiseFactory());
  const [ticketsPeriodoRes, quotesPeriodoRes, cashRes, propertiesRes, contractsRes] = await Promise.all([
    measure('maintenance_tickets.periodo', () => supabase
      .from('maintenance_tickets')
      .select(TICKETS_COLUMNS)
      .or(rangoPeriodoOr(periodo, ['created_at', 'updated_at', 'fecha_cobro_propietario']))
      .order('created_at', { ascending: false })),
    measure('maintenance_quotes.periodo', () => supabase
      .from('maintenance_quotes')
      .select(QUOTES_COLUMNS)
      .or(rangoPeriodoOr(periodo, ['created_at', 'updated_at']))
      .order('created_at', { ascending: false })),
    measure('cash_movements.mantenimiento.periodo', () => supabase
      .from('cash_movements')
      .select(CASH_MOVEMENTS_COLUMNS)
      .in('category', MAINTENANCE_CATEGORIES)
      .gte('date', periodo.startDate)
      .lt('date', periodo.endExclusive)
      .order('date', { ascending: false })),
    measure('properties.mantenimiento.periodo', () => supabase
      .from('properties')
      .select(PROPERTIES_COLUMNS)
      .order('name', { ascending: true })),
    measure('contracts.mantenimiento.periodo', () => supabase
      .from('contracts')
      .select(CONTRACTS_COLUMNS)
      .eq('status', 'activo')
      .order('created_at', { ascending: false })),
  ]);

  if (ticketsPeriodoRes.error) throw ticketsPeriodoRes.error;
  if (quotesPeriodoRes.error) throw quotesPeriodoRes.error;
  if (cashRes.error) throw cashRes.error;
  if (propertiesRes.error) throw propertiesRes.error;
  if (contractsRes.error) throw contractsRes.error;

  const ticketsPeriodo = ticketsPeriodoRes.data || [];
  const quotesPeriodo = quotesPeriodoRes.data || [];
  const cashPeriodo = cashRes.data || [];
  const ticketIdsPeriodo = new Set(ticketsPeriodo.map((ticket) => String(ticket.id)));
  const ticketIdsCaja = [...new Set(cashPeriodo
    .filter((mov) => String(mov.reference_type || '').toLowerCase().includes('maintenance'))
    .map((mov) => mov.reference_id)
    .filter(Boolean)
    .map(String))]
    .filter((id) => !ticketIdsPeriodo.has(id));

  const ticketsCajaRes = ticketIdsCaja.length > 0
    ? await measure('maintenance_tickets.vinculados_caja_periodo', () => supabase
      .from('maintenance_tickets')
      .select(TICKETS_COLUMNS)
      .in('id', ticketIdsCaja))
    : { data: [] };
  if (ticketsCajaRes.error) throw ticketsCajaRes.error;

  const ticketIds = mergePorId(ticketsPeriodo, ticketsCajaRes.data || []).map((ticket) => ticket.id).filter(Boolean);
  const quoteTicketIdsPeriodo = new Set(quotesPeriodo.map((quote) => String(quote.ticket_id)).filter(Boolean));
  const ticketIdsSinQuotes = ticketIds.map(String).filter((id) => !quoteTicketIdsPeriodo.has(id));
  const quotesTicketsRes = ticketIdsSinQuotes.length > 0
    ? await measure('maintenance_quotes.tickets_periodo', () => supabase
      .from('maintenance_quotes')
      .select(QUOTES_COLUMNS)
      .in('ticket_id', ticketIdsSinQuotes))
    : { data: [] };
  if (quotesTicketsRes.error) throw quotesTicketsRes.error;

  return {
    tickets: mergePorId(ticketsPeriodo, ticketsCajaRes.data || []),
    quotes: mergePorId(quotesPeriodo, quotesTicketsRes.data || []),
    cashMovements: cashPeriodo,
    properties: propertiesRes.data || [],
    contracts: contractsRes.data || [],
  };
}
