import {
  CLASIFICACIONES_ECONOMICAS,
  DIRECCIONES_EVENTO,
  ESTADOS_NORMALIZADOS,
  EVENTOS_FINANCIEROS,
  UNIDADES_NEGOCIO,
} from './catalogo';

export const ESTADOS_CONFIANZA_BI = Object.freeze({
  CALCULABLE: 'calculable',
  PARCIAL: 'parcial',
  REQUIERE_CONCILIACION: 'requiere_conciliacion',
  NO_DISPONIBLE: 'no_disponible',
});

const MXN = 'MXN';

export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

export function resolverPeriodo({ year, month, start, end } = {}) {
  if (start && end) {
    const startDate = String(start).slice(0, 10);
    const endDate = String(end).slice(0, 10);
    const endExclusive = sumarDias(endDate, 1);

    return {
      year: Number(startDate.slice(0, 4)),
      month: Number(startDate.slice(5, 7)),
      periodKey: startDate.slice(0, 7),
      startDate,
      endDate,
      endExclusive,
    };
  }

  const now = new Date();
  const y = Number(year || now.getFullYear());
  const m = Number(month || now.getMonth() + 1);

  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new Error('Año inválido para lectura BI');
  }

  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error('Mes inválido para lectura BI');
  }

  const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonth = m === 12 ? 1 : m + 1;
  const endExclusive = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const endDate = sumarDias(endExclusive, -1);

  return {
    year: y,
    month: m,
    periodKey: `${y}-${String(m).padStart(2, '0')}`,
    startDate,
    endDate,
    endExclusive,
  };
}

function sumarDias(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function source(table, id, sourceKey, extra = {}) {
  return {
    source_table: table,
    source_id: id || null,
    source_key: sourceKey,
    ...extra,
  };
}

function eventoBase({
  id,
  sourceTable,
  sourceId,
  sourceKey,
  businessUnit,
  eventType,
  classification,
  direction,
  amount,
  eventDate,
  normalizedStatus,
  originalStatus,
  metadata,
}) {
  return {
    event_id: id,
    source_table: sourceTable,
    source_id: sourceId || null,
    source_key: sourceKey,
    business_unit: businessUnit,
    event_type: eventType,
    economic_classification: classification,
    direction,
    amount: roundMoney(amount),
    currency: MXN,
    event_date: eventDate || null,
    normalized_status: normalizedStatus || ESTADOS_NORMALIZADOS.CONFIRMADO,
    original_status: originalStatus || null,
    metadata: metadata || {},
  };
}

export function mapearEventosCierres({ cierres = [], pagos = [] } = {}) {
  const eventosGenerados = cierres.map((cierre) => eventoBase({
    id: `cierre:${cierre.id}:ingreso_generado`,
    sourceTable: 'cierres',
    sourceId: cierre.id,
    sourceKey: `cierre:${cierre.id}`,
    businessUnit: UNIDADES_NEGOCIO.CIERRES,
    eventType: EVENTOS_FINANCIEROS.INGRESO_GENERADO,
    classification: CLASIFICACIONES_ECONOMICAS.INGRESO_PROPIO,
    direction: DIRECCIONES_EVENTO.ENTRADA,
    amount: cierre.comision,
    eventDate: cierre.fecha_cierre,
    originalStatus: cierre.cobrado_bool ? 'cobrado' : 'pendiente',
    metadata: {
      operacion: cierre.operacion || null,
      vendedor: cierre.vendedor || null,
      propiedad_id: cierre.propiedad_id || null,
      recibo_id: cierre.recibo_id || null,
      firma_id: cierre.firma_id || null,
    },
  }));

  const eventosCobro = pagos.map((pago) => eventoBase({
    id: `cierre_pago:${pago.id}:cobro_recibido`,
    sourceTable: 'cierre_pagos',
    sourceId: pago.id,
    sourceKey: `cierre_pago:${pago.id}`,
    businessUnit: UNIDADES_NEGOCIO.CIERRES,
    eventType: EVENTOS_FINANCIEROS.COBRO_RECIBIDO,
    classification: CLASIFICACIONES_ECONOMICAS.INGRESO_PROPIO,
    direction: DIRECCIONES_EVENTO.ENTRADA,
    amount: pago.monto,
    eventDate: pago.fecha,
    originalStatus: pago.concepto || null,
    metadata: {
      cierre_id: pago.cierre_id || null,
      concepto: pago.concepto || null,
    },
  }));

  return [...eventosGenerados, ...eventosCobro];
}

export function mapearEventosAdministracion({
  comisionesGeneradas = [],
  comisionesCobradas = [],
} = {}) {
  const eventosGenerados = comisionesGeneradas.map((comision) => eventoBase({
    id: `admin:${comision.id}:ingreso_generado`,
    sourceTable: 'comisiones_admin',
    sourceId: comision.id,
    sourceKey: `admin:${comision.contract_id || 'sin_contrato'}:${comision.periodo || comision.id}`,
    businessUnit: UNIDADES_NEGOCIO.ADMINISTRACION,
    eventType: EVENTOS_FINANCIEROS.INGRESO_GENERADO,
    classification: CLASIFICACIONES_ECONOMICAS.INGRESO_PROPIO,
    direction: DIRECCIONES_EVENTO.ENTRADA,
    amount: comision.monto,
    eventDate: periodoAFecha(comision.periodo),
    originalStatus: comision.status || null,
    metadata: {
      contract_id: comision.contract_id || null,
      periodo: comision.periodo || null,
      tipo: comision.tipo || null,
    },
  }));

  const eventosCobro = comisionesCobradas
    .map((comision) => eventoBase({
      id: `admin:${comision.id}:cobro_recibido`,
      sourceTable: 'comisiones_admin',
      sourceId: comision.id,
      sourceKey: `admin:${comision.contract_id || 'sin_contrato'}:${comision.periodo || comision.id}:cobro`,
      businessUnit: UNIDADES_NEGOCIO.ADMINISTRACION,
      eventType: EVENTOS_FINANCIEROS.COBRO_RECIBIDO,
      classification: CLASIFICACIONES_ECONOMICAS.INGRESO_PROPIO,
      direction: DIRECCIONES_EVENTO.ENTRADA,
      amount: comision.monto,
      eventDate: comision.fecha_cobro || periodoAFecha(comision.periodo),
      normalizedStatus: ESTADOS_NORMALIZADOS.COBRADO,
      originalStatus: comision.status || null,
      metadata: {
        contract_id: comision.contract_id || null,
        periodo: comision.periodo || null,
        tipo: comision.tipo || null,
        fecha_cobro: comision.fecha_cobro || null,
      },
    }));

  return [...eventosGenerados, ...eventosCobro];
}

function periodoAFecha(periodo) {
  if (!periodo) return null;
  const valor = String(periodo);
  if (/^\d{4}-\d{2}$/.test(valor)) return `${valor}-01`;
  return valor.slice(0, 10);
}

export function resumirCierres({ cierres = [], pagosPeriodo = [], pagosConciliacion = [] } = {}) {
  const pagosPorCierre = agruparSuma(pagosConciliacion, 'cierre_id', 'monto');
  const generado = suma(cierres, 'comision');
  const cobradoPeriodo = suma(pagosPeriodo, 'monto');

  let pendienteReconstruido = 0;
  let diferenciaCobrado = 0;
  let diferenciaPendiente = 0;
  let registrosSinFecha = 0;

  const detallePendiente = cierres.map((cierre) => {
    const comision = toNumber(cierre.comision);
    const pagos = toNumber(pagosPorCierre.get(cierre.id));
    const pendiente = Math.max(0, roundMoney(comision - pagos));
    const cobradoSistema = toNumber(cierre.cobrado);
    const pendienteSistema = toNumber(cierre.pendiente);

    pendienteReconstruido += pendiente;
    diferenciaCobrado += Math.abs(roundMoney(cobradoSistema - pagos));
    diferenciaPendiente += Math.abs(roundMoney(pendienteSistema - pendiente));
    if (!cierre.fecha_cierre) registrosSinFecha += 1;

    return {
      ...source('cierres', cierre.id, `cierre:${cierre.id}`),
      generado: roundMoney(comision),
      cobrado_reconstruido: roundMoney(pagos),
      cobrado_sistema: roundMoney(cobradoSistema),
      pendiente_reconstruido: roundMoney(pendiente),
      pendiente_sistema: roundMoney(pendienteSistema),
      diferencia_cobrado: roundMoney(cobradoSistema - pagos),
      diferencia_pendiente: roundMoney(pendienteSistema - pendiente),
    };
  });

  const diferenciaTotal = roundMoney(diferenciaCobrado + diferenciaPendiente);

  return {
    unidad: UNIDADES_NEGOCIO.CIERRES,
    metricas: {
      ingreso_generado: roundMoney(generado),
      cobrado: roundMoney(cobradoPeriodo),
      pendiente_reconstruido: roundMoney(pendienteReconstruido),
    },
    conciliacion: {
      estado_confianza: resolverConfianza({ diferenciaTotal, registrosSinFecha }),
      diferencia_cobrado: roundMoney(diferenciaCobrado),
      diferencia_pendiente: roundMoney(diferenciaPendiente),
      registros_revisados: cierres.length,
      pagos_periodo: pagosPeriodo.length,
      pagos_conciliacion: pagosConciliacion.length,
      detalle_pendiente: detallePendiente,
    },
    trazabilidad: {
      fuentes: [
        { tabla: 'cierres', uso: 'ingreso_generado y pendiente_reconstruido' },
        { tabla: 'cierre_pagos', uso: 'cobrado y conciliacion' },
      ],
      source_tables: ['cierres', 'cierre_pagos'],
    },
  };
}

export function resumirAdministracion({ comisionesPeriodo = [], comisionesCobradasPeriodo = [] } = {}) {
  const idsCobradosPeriodo = new Set(comisionesCobradasPeriodo.map((c) => c.id));
  const generado = suma(comisionesPeriodo, 'monto');
  const cobradoPeriodo = suma(comisionesCobradasPeriodo, 'monto');
  let pendienteReconstruido = 0;
  let cobradasSinFecha = 0;

  const detallePendiente = comisionesPeriodo.map((comision) => {
    const monto = toNumber(comision.monto);
    const cobrada = String(comision.status || '').toLowerCase() === 'cobrada';
    const cobradaEnPeriodo = idsCobradosPeriodo.has(comision.id);
    const pendiente = cobrada ? 0 : monto;
    pendienteReconstruido += pendiente;
    if (cobrada && !comision.fecha_cobro) cobradasSinFecha += 1;

    return {
      ...source(
        'comisiones_admin',
        comision.id,
        `admin:${comision.contract_id || 'sin_contrato'}:${comision.periodo || comision.id}`,
      ),
      generado: roundMoney(monto),
      cobrado_en_periodo: cobradaEnPeriodo ? roundMoney(monto) : 0,
      pendiente_reconstruido: roundMoney(pendiente),
      status: comision.status || null,
      fecha_cobro: comision.fecha_cobro || null,
    };
  });

  return {
    unidad: UNIDADES_NEGOCIO.ADMINISTRACION,
    metricas: {
      ingreso_generado: roundMoney(generado),
      cobrado: roundMoney(cobradoPeriodo),
      pendiente_reconstruido: roundMoney(pendienteReconstruido),
    },
    conciliacion: {
      estado_confianza: cobradasSinFecha > 0
        ? ESTADOS_CONFIANZA_BI.PARCIAL
        : ESTADOS_CONFIANZA_BI.CALCULABLE,
      registros_revisados: comisionesPeriodo.length,
      cobros_periodo: comisionesCobradasPeriodo.length,
      cobradas_sin_fecha: cobradasSinFecha,
      detalle_pendiente: detallePendiente,
    },
    trazabilidad: {
      fuentes: [
        { tabla: 'comisiones_admin', uso: 'ingreso_generado, cobrado y pendiente_reconstruido' },
      ],
      source_tables: ['comisiones_admin'],
    },
  };
}

export function combinarResumenBi({ periodo, cierres, administracion }) {
  const ingresoGenerado = roundMoney(
    toNumber(cierres?.metricas?.ingreso_generado) +
    toNumber(administracion?.metricas?.ingreso_generado),
  );
  const cobrado = roundMoney(
    toNumber(cierres?.metricas?.cobrado) +
    toNumber(administracion?.metricas?.cobrado),
  );
  const pendiente = roundMoney(
    toNumber(cierres?.metricas?.pendiente_reconstruido) +
    toNumber(administracion?.metricas?.pendiente_reconstruido),
  );

  return {
    periodo,
    alcance: {
      version: 'V0-07',
      unidades_incluidas: [UNIDADES_NEGOCIO.CIERRES, UNIDADES_NEGOCIO.ADMINISTRACION],
      unidades_excluidas: ['poliza_juridica', 'mantenimiento', 'condominios'],
      nota: 'Lectura BI inicial; no sustituye todavía al dashboard ejecutivo existente.',
    },
    metricas: {
      ingreso_generado: ingresoGenerado,
      cobrado,
      pendiente_reconstruido: pendiente,
    },
    estado_confianza: resolverConfianzaGlobal([
      cierres?.conciliacion?.estado_confianza,
      administracion?.conciliacion?.estado_confianza,
    ]),
    unidades: {
      cierres,
      administracion,
    },
  };
}

function suma(rows, key) {
  return rows.reduce((acc, row) => acc + toNumber(row?.[key]), 0);
}

function agruparSuma(rows, groupKey, amountKey) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row?.[groupKey];
    if (!key) return;
    map.set(key, roundMoney(toNumber(map.get(key)) + toNumber(row?.[amountKey])));
  });
  return map;
}

function resolverConfianza({ diferenciaTotal = 0, registrosSinFecha = 0 }) {
  if (registrosSinFecha > 0) return ESTADOS_CONFIANZA_BI.PARCIAL;
  if (roundMoney(diferenciaTotal) !== 0) return ESTADOS_CONFIANZA_BI.REQUIERE_CONCILIACION;
  return ESTADOS_CONFIANZA_BI.CALCULABLE;
}

function resolverConfianzaGlobal(estados = []) {
  if (estados.includes(ESTADOS_CONFIANZA_BI.NO_DISPONIBLE)) return ESTADOS_CONFIANZA_BI.NO_DISPONIBLE;
  if (estados.includes(ESTADOS_CONFIANZA_BI.REQUIERE_CONCILIACION)) return ESTADOS_CONFIANZA_BI.REQUIERE_CONCILIACION;
  if (estados.includes(ESTADOS_CONFIANZA_BI.PARCIAL)) return ESTADOS_CONFIANZA_BI.PARCIAL;
  return ESTADOS_CONFIANZA_BI.CALCULABLE;
}
