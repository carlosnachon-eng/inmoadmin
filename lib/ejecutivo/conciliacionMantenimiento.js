export const ESTADOS_CONCILIACION_MANTENIMIENTO = {
  conciliado: {
    key: 'conciliado',
    label: '🟢 Conciliado',
    color: '#047857',
    bg: '#ecfdf5',
    border: '#a7f3d0',
  },
  regularizable: {
    key: 'regularizable',
    label: '🟢 Regularizable',
    color: '#047857',
    bg: '#ecfdf5',
    border: '#a7f3d0',
  },
  revision_recomendada: {
    key: 'revision_recomendada',
    label: '🟡 Revisión recomendada',
    color: '#92400e',
    bg: '#fffbeb',
    border: '#fde68a',
  },
  sin_evidencia: {
    key: 'sin_evidencia',
    label: '🔴 Sin evidencia',
    color: '#b91c1c',
    bg: '#fef2f2',
    border: '#fecaca',
  },
};

const STATUS_CANCELADOS = new Set(['cancelado', 'rechazado']);
const STATUS_OPERATIVOS_ACTIVOS = new Set(['aprobado', 'en_proceso', 'terminado', 'cerrado']);
const CATEGORIAS_COBRO = new Set(['mantenimiento_cobrado', 'anticipo_mantenimiento']);
const CATEGORIAS_COSTO = new Set(['pago_proveedor']);

export const redondearMoneda = (value) => Math.round(Number(value || 0) * 100) / 100;

export const dineroIgual = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) <= 0.009;

const normalizar = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

const textoMovimiento = (mov) => normalizar([
  mov?.description,
  mov?.notes,
  mov?.category,
  mov?.reference_type,
  mov?.reference_id,
  mov?.ticket_id,
].filter(Boolean).join(' '));

const textoTicket = (ticket) => normalizar([
  ticket?.id,
  ticket?.title,
  ticket?.property_name,
  ticket?.tenant_name,
].filter(Boolean).join(' '));

const fechaValida = (value) => {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? null : date;
};

const diasEntre = (a, b) => {
  const fa = fechaValida(a);
  const fb = fechaValida(b);
  if (!fa || !fb) return null;
  return Math.abs(fa.getTime() - fb.getTime()) / (1000 * 60 * 60 * 24);
};

export function sumarMonto(movimientos = []) {
  return redondearMoneda(movimientos.reduce((acc, mov) => acc + Number(mov?.amount || mov?.monto || 0), 0));
}

function movimientoPerteneceATicket(mov, ticket) {
  if (!mov || !ticket) return false;

  const explicitTicketId = mov.ticket_id || mov.maintenance_ticket_id;
  if (explicitTicketId && String(explicitTicketId) === String(ticket.id)) return true;

  const referenceType = normalizar(mov.reference_type);
  const referenceId = mov.reference_id;
  if (referenceType && referenceId && referenceType.includes('maintenance') && String(referenceId) === String(ticket.id)) {
    return true;
  }

  const text = textoMovimiento(mov);
  const title = normalizar(ticket.title);
  const property = normalizar(ticket.property_name);
  const idText = normalizar(`#${ticket.id}`);
  const rawId = normalizar(ticket.id);

  if (idText && text.includes(idText)) return true;
  if (rawId && text.includes(`ticket ${rawId}`)) return true;
  if (title && property && text.includes(title) && text.includes(property)) return true;
  if (property && title && text.includes(property) && title.length > 6 && text.includes(title.slice(0, 18))) return true;

  return false;
}

function movimientosDelTicket(ticket, cashMovements = []) {
  return cashMovements.filter((mov) => movimientoPerteneceATicket(mov, ticket));
}

function cotizacionAprobada(ticket, quotes = []) {
  const delTicket = quotes
    .filter((quote) => String(quote.ticket_id) === String(ticket.id))
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));

  return delTicket.find((quote) => quote.status === 'aprobada') || null;
}

function cotizacionesTicket(ticket, quotes = []) {
  return quotes
    .filter((quote) => String(quote.ticket_id) === String(ticket.id))
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
}

function propietarioDeTicket(ticket, properties = [], contracts = []) {
  const property = properties.find((item) => normalizar(item.name) === normalizar(ticket.property_name));
  const contract = contracts.find((item) => normalizar(item.property_name) === normalizar(ticket.property_name) && item.status === 'activo');
  return {
    owner_name: contract?.owner_name || property?.owner_name || property?.owner_email || '—',
    owner_email: property?.owner_email || contract?.owner_email || null,
    tenant_name: ticket.tenant_name || contract?.tenant_name || '—',
  };
}

function evidenciaMovimientos(movimientos = []) {
  return movimientos.map((mov) => ({
    id: mov.id,
    fecha: mov.date || mov.fecha || mov.created_at || '—',
    tipo: mov.type || mov.tipo || '—',
    categoria: mov.category || mov.concepto || '—',
    monto: redondearMoneda(mov.amount || mov.monto),
    descripcion: mov.description || mov.notes || '—',
  }));
}

function detectarDuplicados(movimientos = []) {
  const vistos = new Map();
  const duplicados = [];

  movimientos.forEach((mov) => {
    const key = [
      mov.type || mov.tipo || '',
      mov.category || mov.concepto || '',
      redondearMoneda(mov.amount || mov.monto),
      mov.date || mov.fecha || '',
      normalizar(mov.description || mov.notes || '').slice(0, 80),
    ].join('|');
    if (vistos.has(key)) duplicados.push(mov);
    vistos.set(key, true);
  });

  return duplicados;
}

export function clasificarTicketMantenimiento({ ticket, quotes = [], cashMovements = [], properties = [], contracts = [] }) {
  const quoteAprobada = cotizacionAprobada(ticket, quotes);
  const quotesTicket = cotizacionesTicket(ticket, quotes);
  const movimientos = movimientosDelTicket(ticket, cashMovements);
  const cobrosCaja = movimientos.filter((mov) => (mov.type || mov.tipo) === 'entrada' && CATEGORIAS_COBRO.has(mov.category || mov.concepto));
  const pagosProveedor = movimientos.filter((mov) => (mov.type || mov.tipo) === 'salida' && CATEGORIAS_COSTO.has(mov.category || mov.concepto));
  const duplicados = detectarDuplicados(movimientos);
  const { owner_name, owner_email, tenant_name } = propietarioDeTicket(ticket, properties, contracts);

  const status = ticket.status || '—';
  const cancelado = STATUS_CANCELADOS.has(status);
  const quienPaga = ticket.payer || '—';
  const cargoTicket = redondearMoneda(ticket.charged_amount || 0);
  const costoTicket = redondearMoneda(ticket.provider_cost || 0);
  const montoQuote = redondearMoneda(quoteAprobada?.monto_final || 0);
  const costoQuote = redondearMoneda(quoteAprobada?.costo_proveedor || 0);
  const montoCobrable = montoQuote || cargoTicket;
  const costoProveedor = costoQuote || costoTicket;
  const anticipoRegistrado = redondearMoneda(ticket.advance_amount || 0);
  const anticipoPagado = Boolean(ticket.advance_paid);
  const cobradoCaja = sumarMonto(cobrosCaja);
  const pagadoProveedor = sumarMonto(pagosProveedor);
  const descontadoLiquidacion = Boolean(ticket.descontado_de_liquidacion);
  const cobradoLiquidacion = descontadoLiquidacion ? montoCobrable : 0;
  const cobradoTrazable = redondearMoneda(Math.max(cobradoCaja, cobradoLiquidacion));
  const pendienteCobro = redondearMoneda(Math.max(0, montoCobrable - cobradoTrazable));
  const pendienteProveedor = redondearMoneda(Math.max(0, costoProveedor - pagadoProveedor));
  const margenEstimado = redondearMoneda(montoCobrable - costoProveedor);
  const tieneEvidenciaCobro = cobradoCaja > 0 || descontadoLiquidacion || (anticipoPagado && anticipoRegistrado > 0);
  const activoParaCobro = STATUS_OPERATIVOS_ACTIVOS.has(status) || quoteAprobada;
  const esFondoTercero = ['condominio'].includes(quienPaga);
  const esGastoEmporio = ['inmobiliaria'].includes(quienPaga);

  let estado = 'conciliado';
  let causa = 'La información operativa y financiera disponible no muestra diferencias relevantes.';
  let accion = 'Sin acción requerida.';

  if (cancelado) {
    estado = movimientos.length > 0 ? 'revision_recomendada' : 'conciliado';
    causa = movimientos.length > 0
      ? 'El ticket está cancelado pero tiene movimientos de caja asociados.'
      : 'Ticket cancelado sin movimientos financieros asociados.';
    accion = movimientos.length > 0
      ? 'Revisar si los movimientos deben reclasificarse o devolverse.'
      : 'Sin acción requerida.';
  } else if (duplicados.length > 0) {
    estado = 'revision_recomendada';
    causa = 'Se detectaron movimientos de caja potencialmente duplicados para este ticket.';
    accion = 'Revisar antes de integrar a BI; podría venir de cerrar el ticket más de una vez.';
  } else if (quotesTicket.filter((quote) => quote.status === 'aprobada').length > 1) {
    estado = 'revision_recomendada';
    causa = 'Existe más de una cotización aprobada para el mismo ticket.';
    accion = 'Definir cuál cotización es la fuente de verdad antes de integrar a BI.';
  } else if (quoteAprobada && cargoTicket > 0 && !dineroIgual(montoQuote, cargoTicket)) {
    estado = 'revision_recomendada';
    causa = 'La cotización aprobada y el monto cobrado/cobrable del ticket no coinciden.';
    accion = 'Revisar si hubo descuento, edición manual o actualización pendiente.';
  } else if (esGastoEmporio && cobradoCaja > 0) {
    estado = 'revision_recomendada';
    causa = 'El ticket indica que paga la inmobiliaria, pero existe una entrada de caja por mantenimiento.';
    accion = 'Revisar si el pagador está mal clasificado o si la entrada debe reclasificarse.';
  } else if (esFondoTercero && cobradoCaja > 0) {
    estado = 'revision_recomendada';
    causa = 'El ticket pertenece a condominio; puede ser fondo de terceros y no ingreso propio de Emporio.';
    accion = 'Validar si corresponde a honorario, reembolso o cuota/fondo antes de BI.';
  } else if (montoCobrable > 0 && activoParaCobro && pendienteCobro > 0) {
    estado = tieneEvidenciaCobro ? 'revision_recomendada' : 'sin_evidencia';
    causa = tieneEvidenciaCobro
      ? 'Hay evidencia parcial de cobro, pero no cubre el monto cobrable.'
      : 'Existe monto cobrable/aprobado, pero no hay evidencia suficiente de cobro o liquidación.';
    accion = tieneEvidenciaCobro
      ? 'Validar saldo pendiente o registrar evidencia faltante fuera de esta pantalla.'
      : 'No integrar como cobrado hasta confirmar caja, liquidación o regularización.';
  } else if (status === 'cerrado' && montoCobrable > 0 && !tieneEvidenciaCobro && !esGastoEmporio) {
    estado = 'sin_evidencia';
    causa = 'El ticket está cerrado, pero no hay evidencia trazable de cobro.';
    accion = 'Revisar si fue cobrado, descontado en liquidación o cerrado solo operativamente.';
  } else if (costoProveedor > 0 && status === 'cerrado' && pendienteProveedor > 0) {
    estado = 'revision_recomendada';
    causa = 'El ticket está cerrado, pero no hay evidencia suficiente del pago al proveedor.';
    accion = 'Validar si el proveedor ya fue pagado o si falta registrar evidencia.';
  } else if (anticipoRegistrado > 0 && anticipoPagado && cobrosCaja.length === 0 && !descontadoLiquidacion) {
    estado = 'regularizable';
    causa = 'El anticipo está marcado como pagado, pero no se encontró movimiento de caja vinculado.';
    accion = 'Regularizable a futuro solo si se confirma comprobante; por ahora no se modifica nada.';
  }

  const ultimaCaja = movimientos
    .map((mov) => mov.date || mov.fecha || mov.created_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const diasTicketCaja = ultimaCaja ? diasEntre(ticket.updated_at || ticket.created_at, ultimaCaja) : null;

  return {
    id: ticket.id,
    ticket_id: ticket.id,
    propiedad: ticket.property_name || '—',
    inquilino: tenant_name,
    propietario: owner_name,
    propietario_email: owner_email,
    quien_paga: quienPaga,
    status_operativo: status,
    cotizacion_aprobada: Boolean(quoteAprobada),
    cotizacion_id: quoteAprobada?.id || null,
    costo_proveedor: costoProveedor,
    monto_cobrable: montoCobrable,
    anticipo_registrado: anticipoRegistrado,
    anticipo_pagado: anticipoPagado,
    movimientos_encontrados: movimientos.length,
    cobrado_caja: cobradoCaja,
    pagado_proveedor: pagadoProveedor,
    descontado_liquidacion: descontadoLiquidacion,
    fecha_cobro_propietario: ticket.fecha_cobro_propietario || null,
    recibo_cobro_id: ticket.recibo_cobro_id || null,
    cobrado_trazable: cobradoTrazable,
    pendiente_cobro: pendienteCobro,
    pendiente_proveedor: pendienteProveedor,
    margen_estimado: margenEstimado,
    estado,
    causa_probable: causa,
    accion_sugerida: accion,
    evidencia: {
      ticket: {
        created_at: ticket.created_at || null,
        updated_at: ticket.updated_at || null,
        title: ticket.title || '—',
        description: ticket.description || '—',
        texto_busqueda: textoTicket(ticket),
      },
      cotizaciones: quotesTicket.map((quote) => ({
        id: quote.id,
        status: quote.status || '—',
        monto_final: redondearMoneda(quote.monto_final),
        costo_proveedor: redondearMoneda(quote.costo_proveedor),
        updated_at: quote.updated_at || quote.created_at || null,
      })),
      caja: evidenciaMovimientos(movimientos),
      cobros_caja: evidenciaMovimientos(cobrosCaja),
      pagos_proveedor: evidenciaMovimientos(pagosProveedor),
      duplicados: evidenciaMovimientos(duplicados),
      liquidacion: {
        descontado_de_liquidacion: descontadoLiquidacion,
        fecha_cobro_propietario: ticket.fecha_cobro_propietario || null,
        forma_cobro_propietario: ticket.forma_cobro_propietario || null,
        recibo_cobro_id: ticket.recibo_cobro_id || null,
      },
      dias_entre_ticket_y_caja: diasTicketCaja,
    },
  };
}

export function construirConciliacionMantenimiento({
  tickets = [],
  quotes = [],
  cashMovements = [],
  properties = [],
  contracts = [],
} = {}) {
  const casos = tickets.map((ticket) => clasificarTicketMantenimiento({
    ticket,
    quotes,
    cashMovements,
    properties,
    contracts,
  }));

  const resumen = casos.reduce((acc, caso) => {
    acc.total += 1;
    acc[caso.estado] = (acc[caso.estado] || 0) + 1;
    if (caso.estado !== 'conciliado') {
      acc.inconsistencias_activas += 1;
      acc.diferencia_activa = redondearMoneda(acc.diferencia_activa + Math.abs(caso.pendiente_cobro || 0));
    }
    acc.monto_cobrable = redondearMoneda(acc.monto_cobrable + (caso.monto_cobrable || 0));
    acc.cobrado_trazable = redondearMoneda(acc.cobrado_trazable + (caso.cobrado_trazable || 0));
    acc.costo_proveedor = redondearMoneda(acc.costo_proveedor + (caso.costo_proveedor || 0));
    acc.margen_estimado = redondearMoneda(acc.margen_estimado + (caso.margen_estimado || 0));
    return acc;
  }, {
    total: 0,
    inconsistencias_activas: 0,
    diferencia_activa: 0,
    conciliado: 0,
    regularizable: 0,
    revision_recomendada: 0,
    sin_evidencia: 0,
    monto_cobrable: 0,
    cobrado_trazable: 0,
    costo_proveedor: 0,
    margen_estimado: 0,
  });

  return {
    resumen,
    casos: casos.sort((a, b) => {
      const prioridad = {
        sin_evidencia: 0,
        revision_recomendada: 1,
        regularizable: 2,
        conciliado: 3,
      };
      if (prioridad[a.estado] !== prioridad[b.estado]) return prioridad[a.estado] - prioridad[b.estado];
      return Number(b.ticket_id || 0) - Number(a.ticket_id || 0);
    }),
  };
}

export function coincideBusquedaMantenimiento(caso, busqueda = '') {
  const q = normalizar(busqueda);
  if (!q) return true;
  return [
    caso.ticket_id,
    caso.propiedad,
    caso.inquilino,
    caso.propietario,
    caso.quien_paga,
    caso.status_operativo,
    caso.causa_probable,
    caso.evidencia?.ticket?.title,
  ].some((value) => normalizar(value).includes(q));
}

export function textoEvidenciaMantenimiento(evidencia) {
  try {
    return JSON.stringify(evidencia || {}, null, 2);
  } catch (_err) {
    return '{}';
  }
}
