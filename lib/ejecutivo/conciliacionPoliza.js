export const ESTADOS_CONCILIACION_POLIZA = {
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
  ignorado: {
    key: 'ignorado',
    label: '⚫ Ignorado',
    color: '#374151',
    bg: '#f3f4f6',
    border: '#d1d5db',
  },
};

const CONCEPTOS_POLIZA = new Set(['anticipo_poliza', 'pago_poliza', 'saldo_poliza']);
const CONCEPTOS_INGRESO_BI = new Set(['investigacion', 'anticipo_poliza', 'pago_poliza', 'saldo_poliza']);
const CONCEPTOS_NO_BI = new Set(['gasto_juridico', 'no_bi']);

export const redondearMoneda = (value) => Math.round(Number(value || 0) * 100) / 100;

export const dineroIgual = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) <= 0.009;

export const sumarMovimientos = (movimientos = []) => redondearMoneda(
  movimientos.reduce((acc, mov) => {
    const monto = Number(mov?.monto || 0);
    return acc + (mov?.tipo === 'egreso' ? -monto : monto);
  }, 0)
);

const normalizar = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function estadoFinancieroPoliza({ montoGenerado, cobrado }) {
  const generado = redondearMoneda(montoGenerado);
  const pagado = redondearMoneda(cobrado);
  if (generado <= 0 && pagado <= 0) return 'Sin monto';
  if (generado <= 0 && pagado > 0) return 'Caja sin monto generado';
  if (pagado > generado && !dineroIgual(pagado, generado)) return 'Sobrecobrada';
  if (dineroIgual(pagado, generado)) return 'Cobrada';
  if (pagado > 0) return 'Parcial';
  return 'Pendiente';
}

function evidenciaCaja(movimientos = []) {
  return movimientos.map((mov) => ({
    id: mov.id,
    fecha: mov.fecha || '—',
    tipo: mov.tipo || '—',
    concepto: mov.concepto || '—',
    monto: redondearMoneda(mov.monto),
    descripcion: mov.descripcion || '—',
  }));
}

export function clasificarExpedientePoliza({ expediente, movimientos = [] }) {
  const ingresosPoliza = movimientos.filter((mov) => mov.tipo === 'ingreso' && CONCEPTOS_POLIZA.has(mov.concepto));
  const anticiposCaja = ingresosPoliza.filter((mov) => mov.concepto === 'anticipo_poliza');
  const pagosFinalesCaja = ingresosPoliza.filter((mov) => ['pago_poliza', 'saldo_poliza'].includes(mov.concepto));
  const otrosCaja = movimientos.filter((mov) => mov.concepto === 'otro');

  const montoPoliza = redondearMoneda(expediente?.monto_poliza || 0);
  const anticipoOperativo = redondearMoneda(expediente?.anticipo_poliza || 0);
  const cobradoCaja = sumarMovimientos(ingresosPoliza);
  const cobradoAnticipo = sumarMovimientos(anticiposCaja);
  const cobradoFinal = sumarMovimientos(pagosFinalesCaja);
  const pendiente = redondearMoneda(Math.max(0, montoPoliza - cobradoCaja));
  const diferencia = redondearMoneda(montoPoliza - cobradoCaja);
  const anticipoPagado = Boolean(expediente?.anticipo_pagado);
  const saldoPagado = Boolean(expediente?.saldo_pagado);

  const financiero = estadoFinancieroPoliza({ montoGenerado: montoPoliza, cobrado: cobradoCaja });
  let estado = 'conciliado';
  let causa = 'El estado operativo coincide con la evidencia financiera disponible.';
  let accion = 'Sin acción requerida.';

  if (otrosCaja.length > 0) {
    estado = 'revision_recomendada';
    causa = 'El expediente tiene movimientos con concepto "otro" que pueden contaminar BI si no se clasifican.';
    accion = 'Clasificar el movimiento de caja antes de integrarlo a BI.';
  }

  if (montoPoliza <= 0 && cobradoCaja > 0) {
    estado = 'revision_recomendada';
    causa = 'Existe caja vinculada al expediente, pero el expediente no tiene monto de póliza generado.';
    accion = 'Revisar el monto de póliza del expediente o reclasificar el movimiento.';
  } else if (saldoPagado && cobradoCaja + 0.009 < montoPoliza) {
    estado = cobradoCaja > 0 ? 'revision_recomendada' : 'sin_evidencia';
    causa = 'La póliza está marcada como liquidada, pero la caja vinculada no cubre el monto generado.';
    accion = 'No integrar como cobrada hasta validar o registrar evidencia de caja.';
  } else if (!saldoPagado && montoPoliza > 0 && cobradoCaja >= montoPoliza - 0.009) {
    estado = 'regularizable';
    causa = 'La caja cubre el monto de póliza, pero el expediente no está marcado como liquidado.';
    accion = 'Regularizable a futuro: actualizar estado operativo con confirmación, sin tocar caja.';
  } else if (anticipoPagado && anticipoOperativo > 0 && cobradoAnticipo + 0.009 < anticipoOperativo) {
    estado = cobradoAnticipo > 0 ? 'revision_recomendada' : 'sin_evidencia';
    causa = 'El anticipo está marcado como cobrado, pero no hay caja suficiente para respaldarlo.';
    accion = 'Validar anticipo antes de integrar este expediente a BI.';
  } else if (!anticipoPagado && anticipoOperativo > 0 && cobradoAnticipo >= anticipoOperativo - 0.009) {
    estado = 'regularizable';
    causa = 'Existe caja de anticipo suficiente, pero el anticipo operativo no está marcado como pagado.';
    accion = 'Regularizable a futuro: actualizar anticipo pagado con confirmación.';
  } else if (cobradoCaja > montoPoliza + 0.009) {
    estado = 'revision_recomendada';
    causa = 'La caja vinculada supera el monto de póliza generado.';
    accion = 'Revisar duplicidad de movimientos o monto de póliza.';
  }

  return {
    tipo: 'expediente_poliza',
    id: `expediente-${expediente?.id}`,
    cliente: expediente?.nombre_arrendatario || '—',
    inmueble: expediente?.direccion_inmueble || '—',
    expediente_id: expediente?.id || null,
    solicitud_id: expediente?.inquilino_id || null,
    status_operativo: expediente?.status || expediente?.status_expediente || '—',
    status_expediente: expediente?.status_expediente || '—',
    monto_generado: montoPoliza,
    cobrado_caja: cobradoCaja,
    pendiente_calculado: pendiente,
    anticipo_pagado_operativo: anticipoPagado,
    saldo_pagado_operativo: saldoPagado,
    estado_financiero: financiero,
    diferencia,
    estado,
    causa_probable: causa,
    accion_sugerida: accion,
    evidencia: {
      caja: evidenciaCaja(movimientos),
      ingresos_poliza: evidenciaCaja(ingresosPoliza),
      anticipo_caja: redondearMoneda(cobradoAnticipo),
      pago_final_caja: redondearMoneda(cobradoFinal),
      movimientos_otro: evidenciaCaja(otrosCaja),
    },
  };
}

export function clasificarSolicitudInvestigacion({ solicitud, movimientos = [] }) {
  const ingresosInvestigacion = movimientos.filter((mov) => mov.tipo === 'ingreso' && mov.concepto === 'investigacion');
  const cobradoCaja = sumarMovimientos(ingresosInvestigacion);
  const cobroOperativo = Boolean(solicitud?.cobro_investigacion);
  const montoGenerado = redondearMoneda(solicitud?.monto_investigacion || (cobroOperativo || cobradoCaja > 0 ? 1000 : 0));
  const pendiente = redondearMoneda(Math.max(0, montoGenerado - cobradoCaja));
  const diferencia = redondearMoneda(montoGenerado - cobradoCaja);

  let estado = 'conciliado';
  let causa = 'El cobro de investigación coincide con la caja vinculada.';
  let accion = 'Sin acción requerida.';

  if (cobroOperativo && cobradoCaja + 0.009 < montoGenerado) {
    estado = cobradoCaja > 0 ? 'revision_recomendada' : 'sin_evidencia';
    causa = 'La investigación está marcada como cobrada, pero no hay caja suficiente vinculada.';
    accion = 'Validar o registrar evidencia de caja antes de integrar a BI.';
  } else if (!cobroOperativo && cobradoCaja >= montoGenerado - 0.009 && cobradoCaja > 0) {
    estado = 'regularizable';
    causa = 'Existe caja de investigación, pero la solicitud no está marcada como cobrada.';
    accion = 'Regularizable a futuro: actualizar estado operativo con confirmación.';
  } else if (cobradoCaja > montoGenerado + 0.009) {
    estado = 'revision_recomendada';
    causa = 'La caja de investigación supera el monto esperado.';
    accion = 'Revisar si existe duplicidad o monto de investigación incorrecto.';
  }

  return {
    tipo: 'investigacion',
    id: `solicitud-${solicitud?.id}`,
    cliente: solicitud?.nombre_completo || solicitud?.razon_social || '—',
    inmueble: solicitud?.inmueble_interes || '—',
    expediente_id: null,
    solicitud_id: solicitud?.id || null,
    status_operativo: solicitud?.status || '—',
    status_expediente: '—',
    monto_generado: montoGenerado,
    cobrado_caja: cobradoCaja,
    pendiente_calculado: pendiente,
    anticipo_pagado_operativo: false,
    saldo_pagado_operativo: cobroOperativo,
    estado_financiero: estadoFinancieroPoliza({ montoGenerado, cobrado: cobradoCaja }),
    diferencia,
    estado,
    causa_probable: causa,
    accion_sugerida: accion,
    evidencia: {
      caja: evidenciaCaja(movimientos),
      ingresos_investigacion: evidenciaCaja(ingresosInvestigacion),
      monto_operativo: solicitud?.monto_investigacion || null,
      fecha_cobro_operativa: solicitud?.fecha_cobro_investigacion || null,
    },
  };
}

export function clasificarMovimientoCajaPoliza({ movimiento }) {
  const esOtro = movimiento?.concepto === 'otro';
  const esNoBi = CONCEPTOS_NO_BI.has(movimiento?.concepto);
  const sinVinculo = !movimiento?.expediente_id && !movimiento?.solicitud_id;
  const conceptoBI = CONCEPTOS_INGRESO_BI.has(movimiento?.concepto);

  if (esNoBi) {
    return {
      tipo: 'movimiento_caja',
      id: `caja-${movimiento?.id}`,
      movimiento_id: movimiento?.id || null,
      cliente: movimiento?.nombre_cliente || '—',
      inmueble: '—',
      expediente_id: movimiento?.expediente_id || null,
      solicitud_id: movimiento?.solicitud_id || null,
      status_operativo: 'Movimiento caja',
      status_expediente: '—',
      monto_generado: 0,
      cobrado_caja: movimiento?.tipo === 'egreso' ? -redondearMoneda(movimiento?.monto) : redondearMoneda(movimiento?.monto),
      pendiente_calculado: 0,
      anticipo_pagado_operativo: false,
      saldo_pagado_operativo: false,
      estado_financiero: 'Fuera de BI',
      diferencia: 0,
      estado: 'conciliado',
      causa_probable: 'Movimiento clasificado fuera del BI financiero de póliza.',
      accion_sugerida: 'Sin acción requerida.',
      evidencia: {
        caja: evidenciaCaja([movimiento]),
      },
    };
  }

  let estado = 'revision_recomendada';
  let causa = 'Movimiento de caja requiere revisión.';
  let accion = 'Revisar trazabilidad antes de integrar a BI.';

  if (esOtro) {
    causa = 'Movimiento con concepto "otro"; no se puede clasificar automáticamente para BI.';
    accion = 'Clasificar el concepto o dejarlo fuera del BI financiero.';
  } else if (sinVinculo) {
    causa = conceptoBI
      ? 'Movimiento financiero válido, pero sin expediente ni solicitud vinculada.'
      : 'Movimiento sin vínculo y con concepto no reconocido para BI.';
    accion = 'Vincular a expediente/solicitud o reclasificar manualmente.';
  }

  return {
    tipo: 'movimiento_caja',
    id: `caja-${movimiento?.id}`,
    movimiento_id: movimiento?.id || null,
    cliente: movimiento?.nombre_cliente || '—',
    inmueble: '—',
    expediente_id: movimiento?.expediente_id || null,
    solicitud_id: movimiento?.solicitud_id || null,
    status_operativo: 'Movimiento caja',
    status_expediente: '—',
    monto_generado: 0,
    cobrado_caja: movimiento?.tipo === 'egreso' ? -redondearMoneda(movimiento?.monto) : redondearMoneda(movimiento?.monto),
    pendiente_calculado: 0,
    anticipo_pagado_operativo: false,
    saldo_pagado_operativo: false,
    estado_financiero: esOtro ? 'Pendiente de clasificación' : 'Sin vínculo',
    diferencia: movimiento?.tipo === 'egreso' ? -redondearMoneda(movimiento?.monto) : redondearMoneda(movimiento?.monto),
    estado,
    causa_probable: causa,
    accion_sugerida: accion,
    evidencia: {
      caja: evidenciaCaja([movimiento]),
    },
  };
}

export function construirConciliacionPoliza({ expedientes = [], solicitudes = [], caja = [] }) {
  const cajaPorExpediente = new Map();
  const cajaPorSolicitud = new Map();

  caja.forEach((movimiento) => {
    if (movimiento.expediente_id) {
      const key = String(movimiento.expediente_id);
      cajaPorExpediente.set(key, [...(cajaPorExpediente.get(key) || []), movimiento]);
    }
    if (movimiento.solicitud_id) {
      const key = String(movimiento.solicitud_id);
      cajaPorSolicitud.set(key, [...(cajaPorSolicitud.get(key) || []), movimiento]);
    }
  });

  const itemsExpedientes = expedientes
    .filter((expediente) => Number(expediente?.monto_poliza || 0) > 0 || cajaPorExpediente.has(String(expediente?.id)))
    .map((expediente) => clasificarExpedientePoliza({
      expediente,
      movimientos: cajaPorExpediente.get(String(expediente.id)) || [],
    }));

  const itemsSolicitudes = solicitudes
    .filter((solicitud) => solicitud?.cobro_investigacion || Number(solicitud?.monto_investigacion || 0) > 0 || cajaPorSolicitud.has(String(solicitud?.id)))
    .map((solicitud) => clasificarSolicitudInvestigacion({
      solicitud,
      movimientos: cajaPorSolicitud.get(String(solicitud.id)) || [],
    }));

  const movimientosEspeciales = caja
    .filter((movimiento) => {
      if (CONCEPTOS_NO_BI.has(movimiento.concepto)) return false;
      return movimiento.concepto === 'otro' || (!movimiento.expediente_id && !movimiento.solicitud_id);
    })
    .map((movimiento) => clasificarMovimientoCajaPoliza({ movimiento }));

  const vistos = new Set();
  const items = [...itemsExpedientes, ...itemsSolicitudes, ...movimientosEspeciales]
    .filter((item) => {
      if (vistos.has(item.id)) return false;
      vistos.add(item.id);
      return true;
    })
    .sort((a, b) => {
      const peso = { sin_evidencia: 0, revision_recomendada: 1, regularizable: 2, conciliado: 3, ignorado: 4 };
      return (peso[a.estado] ?? 9) - (peso[b.estado] ?? 9) || Math.abs(b.diferencia || 0) - Math.abs(a.diferencia || 0);
    });

  return {
    items,
    resumen: construirResumenPoliza(items),
  };
}

export function construirResumenPoliza(items = []) {
  return items.reduce((acc, item) => {
    acc.total += 1;
    acc[item.estado] = (acc[item.estado] || 0) + 1;
    if (item.estado !== 'conciliado' && item.estado !== 'ignorado') {
      acc.inconsistencias_activas += 1;
      acc.diferencia_acumulada += Math.abs(Number(item.diferencia || 0));
    }
    if (item.tipo === 'movimiento_caja') acc.movimientos_caja_revision += 1;
    return acc;
  }, {
    total: 0,
    inconsistencias_activas: 0,
    conciliado: 0,
    regularizable: 0,
    revision_recomendada: 0,
    sin_evidencia: 0,
    ignorado: 0,
    movimientos_caja_revision: 0,
    diferencia_acumulada: 0,
  });
}

export function textoEvidencia(item) {
  const evidencia = item?.evidencia || {};
  const caja = evidencia.caja || [];
  if (caja.length === 0) return 'Sin movimientos de caja vinculados.';
  return caja.map((mov) => `${mov.fecha} · ${mov.tipo}/${mov.concepto} · ${redondearMoneda(mov.monto).toLocaleString('es-MX')} · ${mov.descripcion}`).join('\n');
}

export function coincideBusquedaPoliza(item, busqueda) {
  const q = normalizar(busqueda);
  if (!q) return true;
  return [
    item.cliente,
    item.inmueble,
    item.expediente_id,
    item.solicitud_id,
    item.status_operativo,
    item.estado,
    item.causa_probable,
  ].some((value) => normalizar(value).includes(q));
}
