export const ESTADOS_CONCILIACION_COMISIONES_ADMIN = {
  conciliada: {
    key: 'conciliada',
    label: '🟢 Conciliada',
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

export const redondearMoneda = (value) => Math.round(Number(value || 0) * 100) / 100;

export const dineroIgual = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) <= 0.009;

export const periodoLabel = (periodo) => {
  if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return periodo || '—';
  const [year, month] = periodo.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
};

export const periodoEnRango = (fecha, periodo) => {
  if (!fecha || !periodo || !/^\d{4}-\d{2}$/.test(periodo)) return false;
  const [year, month] = periodo.split('-').map(Number);
  const date = new Date(`${fecha}T12:00:00`);
  return date.getFullYear() === year && date.getMonth() === month - 1;
};

const norm = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function calcularComisionContrato(contract) {
  if (!contract?.commission_value) return 0;
  if (contract.commission_type === 'porcentaje') {
    return redondearMoneda((Number(contract.monthly_rent || 0) * Number(contract.commission_value || 0)) / 100);
  }
  return redondearMoneda(contract.commission_value);
}

export function buscarPagoRenta({ payments = [], contract, periodo }) {
  return payments.find((payment) => {
    if (payment.contract_id !== contract?.id) return false;
    if (payment.status !== 'pagado') return false;
    const porCamposPeriodo = Number(payment.period_year) === Number(periodo?.slice(0, 4))
      && Number(payment.period_month) === Number(periodo?.slice(5, 7));
    const porFecha = periodoEnRango(payment.due_date, periodo) || periodoEnRango(payment.payment_date, periodo);
    return porCamposPeriodo || porFecha;
  }) || null;
}

export function buscarLiquidacionPropietario({ ownerPayments = [], property, contract, periodo, comision }) {
  const label = norm(periodoLabel(periodo));
  const propertyName = norm(contract?.property_name);
  const renta = Number(contract?.monthly_rent || 0);
  const liquidoEsperado = redondearMoneda(renta - Number(comision || 0));

  const candidatas = ownerPayments.filter((payment) => {
    if (payment.status !== 'pagado') return false;
    if (payment.rent_receiver !== 'inmobiliaria') return false;
    if (property?.owner_email && norm(payment.owner_email) !== norm(property.owner_email)) return false;
    if (label && norm(payment.period_description) !== label) return false;
    if (propertyName && norm(payment.notes).includes(propertyName)) return true;
    if (propertyName && norm(payment.properties).includes(propertyName)) return true;
    if (dineroIgual(payment.amount_paid, liquidoEsperado)) return true;
    if (dineroIgual(payment.total_liquid, liquidoEsperado)) return true;
    return false;
  });

  return candidatas[0] || null;
}

export function buscarCashMovements({ cashMovements = [], ownerPayment, contract, ownerName, periodo, comision }) {
  const propertyName = norm(contract?.property_name);
  const owner = norm(ownerName);
  const periodoTexto = norm(periodoLabel(periodo));

  const renta = cashMovements.find((movement) =>
    movement.type === 'entrada'
      && movement.category === 'renta_cobrada'
      && periodoEnRango(movement.date, periodo)
      && (!propertyName || norm(movement.description).includes(propertyName))
  ) || null;

  const salidaLiquidacion = cashMovements.find((movement) =>
    movement.type === 'salida'
      && movement.category === 'liquidacion_propietario'
      && (!owner || norm(movement.description).includes(owner))
      && (!periodoTexto || norm(movement.description).includes(periodoTexto))
      && (!ownerPayment || dineroIgual(movement.amount, ownerPayment.amount_paid))
  ) || null;

  const entradaComision = cashMovements.find((movement) =>
    movement.type === 'entrada'
      && movement.category === 'comision_cobrada'
      && (!owner || norm(movement.description).includes(owner) || norm(movement.notes).includes(owner))
      && (!periodoTexto || norm(movement.description).includes(periodoTexto) || norm(movement.notes).includes(periodoTexto))
      && dineroIgual(movement.amount, comision)
  ) || null;

  return {
    renta,
    salidaLiquidacion,
    entradaComision,
  };
}

export function clasificarComisionAdmin({ comision, contract, property, payments = [], ownerPayments = [], cashMovements = [] }) {
  const montoComision = redondearMoneda(comision?.monto || calcularComisionContrato(contract));
  const renta = redondearMoneda(contract?.monthly_rent || 0);
  const pagoRenta = buscarPagoRenta({ payments, contract, periodo: comision?.periodo });
  const liquidacion = buscarLiquidacionPropietario({
    ownerPayments,
    property,
    contract,
    periodo: comision?.periodo,
    comision: montoComision,
  });
  const caja = buscarCashMovements({
    cashMovements,
    ownerPayment: liquidacion,
    contract,
    ownerName: contract?.owner_name,
    periodo: comision?.periodo,
    comision: montoComision,
  });

  if (comision?.status === 'cobrada') {
    return {
      estado: 'conciliada',
      causa_probable: 'La comisión ya está marcada como cobrada.',
      accion_sugerida: 'Sin acción requerida.',
      evidencia: { pagoRenta, liquidacion, caja },
      regularizacion: null,
    };
  }

  const liquidacionCuadra = liquidacion && dineroIgual(liquidacion.amount_paid, renta - montoComision);
  const rentaCobrada = Boolean(pagoRenta || caja.renta);
  const evidenciaFuerte = rentaCobrada && liquidacionCuadra;

  if (evidenciaFuerte) {
    return {
      estado: 'regularizable',
      causa_probable: 'La renta y la liquidación ya fueron procesadas, pero la comisión sigue pendiente.',
      accion_sugerida: 'Regularizar comisión: marcar como cobrada y completar trazabilidad en caja si falta.',
      evidencia: { pagoRenta, liquidacion, caja },
      regularizacion: {
        fecha_cobro: liquidacion.payment_date || pagoRenta?.payment_date || pagoRenta?.due_date || new Date().toISOString().slice(0, 10),
        monto: montoComision,
        crear_salida_liquidacion: !caja.salidaLiquidacion,
        crear_entrada_comision: !caja.entradaComision,
      },
    };
  }

  if (rentaCobrada || liquidacion) {
    return {
      estado: 'revision_recomendada',
      causa_probable: 'Hay evidencia parcial de renta o liquidación, pero no cuadra completamente.',
      accion_sugerida: 'Revisar manualmente antes de modificar comisión o caja.',
      evidencia: { pagoRenta, liquidacion, caja },
      regularizacion: null,
    };
  }

  return {
    estado: 'sin_evidencia',
    causa_probable: 'No se encontró renta pagada ni liquidación suficiente para respaldar la comisión.',
    accion_sugerida: 'No regularizar automáticamente.',
    evidencia: { pagoRenta, liquidacion, caja },
    regularizacion: null,
  };
}

export function construirResumenComisionesAdmin(items = []) {
  return items.reduce((acc, item) => {
    acc.total_revisadas += 1;
    acc[item.estado] = (acc[item.estado] || 0) + 1;
    if (item.estado !== 'conciliada') {
      acc.pendientes += 1;
      acc.monto_pendiente += Number(item.comision_emporio || 0);
    }
    return acc;
  }, {
    total_revisadas: 0,
    pendientes: 0,
    regularizable: 0,
    revision_recomendada: 0,
    sin_evidencia: 0,
    conciliada: 0,
    monto_pendiente: 0,
  });
}
