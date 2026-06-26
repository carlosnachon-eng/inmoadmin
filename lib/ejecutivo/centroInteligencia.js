import { ESTADOS_CONFIANZA_BI, roundMoney, toNumber } from './lecturaBiCierresAdmin';
import { construirConciliacionPoliza } from './conciliacionPoliza';
import { construirConciliacionMantenimiento } from './conciliacionMantenimiento';

const CONCEPTOS_POLIZA_INGRESO = new Set(['investigacion', 'anticipo_poliza', 'pago_poliza', 'saldo_poliza']);
const STATUS_MANTENIMIENTO_EXCLUIDOS = new Set(['cancelado', 'rechazado']);

const fechaEnPeriodo = (value, periodo) => {
  if (!value) return false;
  const date = String(value).slice(0, 10);
  return date >= periodo.startDate && date < periodo.endExclusive;
};

const primeraFecha = (...values) => values.find(Boolean) || null;

const fechaEconomicaPoliza = (expediente) => primeraFecha(
  expediente?.fecha_firma,
  expediente?.fecha_inicio,
);

const fechaEconomicaInvestigacion = (solicitud) => primeraFecha(
  solicitud?.fecha_cobro_investigacion,
  solicitud?.fecha_pago_investigacion,
);

const fechaCotizacionAprobada = (caso) => {
  const aprobada = (caso.evidencia?.cotizaciones || []).find((quote) => quote.status === 'aprobada');
  return aprobada?.updated_at || null;
};

const fechaLiquidacionMantenimiento = (caso) => primeraFecha(
  caso.evidencia?.liquidacion?.fecha_cobro_propietario,
  caso.fecha_cobro_propietario,
);

const cajaEnPeriodo = (movimientos = [], periodo) => movimientos.filter((mov) => fechaEnPeriodo(mov.fecha, periodo));

const sumaEvidenciaCaja = (movimientos = []) => roundMoney(
  movimientos.reduce((acc, mov) => acc + toNumber(mov.monto), 0),
);

const pct = (numerador, denominador) => {
  const den = Number(denominador || 0);
  if (den <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((Number(numerador || 0) / den) * 100)));
};

export function confianzaDesdeResumen(resumen = {}) {
  const total = Number(resumen.total || 0);
  if (total <= 0) return 100;
  const buenos = Number(resumen.conciliado || 0) + Number(resumen.ignorado || 0);
  return pct(buenos, total);
}

export function estadoConfianzaDesdePct(valor) {
  if (valor >= 90) return ESTADOS_CONFIANZA_BI.CALCULABLE;
  if (valor >= 75) return ESTADOS_CONFIANZA_BI.PARCIAL;
  return ESTADOS_CONFIANZA_BI.REQUIERE_CONCILIACION;
}

export function etiquetaConfianza(estado) {
  const labels = {
    [ESTADOS_CONFIANZA_BI.CALCULABLE]: 'Alta',
    [ESTADOS_CONFIANZA_BI.PARCIAL]: 'En validación',
    [ESTADOS_CONFIANZA_BI.REQUIERE_CONCILIACION]: 'Requiere revisión',
    [ESTADOS_CONFIANZA_BI.NO_DISPONIBLE]: 'No disponible',
  };
  return labels[estado] || 'En validación';
}

export function resumirPolizaCentro({ periodo, expedientes = [], solicitudes = [], caja = [] }) {
  const conciliacion = construirConciliacionPoliza({ expedientes, solicitudes, caja });

  const idsExpedientesGenerados = new Set(
    expedientes
      .filter((expediente) => fechaEnPeriodo(fechaEconomicaPoliza(expediente), periodo))
      .map((expediente) => String(expediente.id)),
  );
  const idsSolicitudesGeneradas = new Set(
    solicitudes
      .filter((solicitud) => fechaEnPeriodo(fechaEconomicaInvestigacion(solicitud), periodo))
      .map((solicitud) => String(solicitud.id)),
  );

  const generado = conciliacion.items.reduce((acc, item) => {
    if (item.tipo === 'expediente_poliza' && idsExpedientesGenerados.has(String(item.expediente_id))) {
      return acc + toNumber(item.monto_generado);
    }
    if (item.tipo === 'investigacion' && idsSolicitudesGeneradas.has(String(item.solicitud_id))) {
      return acc + toNumber(item.monto_generado);
    }
    return acc;
  }, 0);

  const cajaPeriodo = caja.filter((mov) => {
    if (mov.tipo !== 'ingreso') return false;
    if (!CONCEPTOS_POLIZA_INGRESO.has(mov.concepto)) return false;
    return fechaEnPeriodo(mov.fecha || mov.created_at, periodo);
  });
  const cobrado = cajaPeriodo.reduce((acc, mov) => acc + toNumber(mov.monto), 0);
  const costosDirectos = caja
    .filter((mov) => mov.tipo === 'egreso' && fechaEnPeriodo(mov.fecha || mov.created_at, periodo))
    .reduce((acc, mov) => acc + toNumber(mov.monto), 0);

  const pendiente = conciliacion.items.reduce((acc, item) => {
    if (item.tipo === 'expediente_poliza' && idsExpedientesGenerados.has(String(item.expediente_id))) {
      return acc + toNumber(item.pendiente_calculado);
    }
    if (item.tipo === 'investigacion' && idsSolicitudesGeneradas.has(String(item.solicitud_id))) {
      return acc + toNumber(item.pendiente_calculado);
    }
    return acc;
  }, 0);

  const confianzaPorcentaje = confianzaDesdeResumen(conciliacion.resumen);
  const estadoConfianza = estadoConfianzaDesdePct(confianzaPorcentaje);

  return {
    key: 'poliza_juridica',
    label: 'Póliza Jurídica',
    metricas: {
      generado: roundMoney(generado),
      cobrado: roundMoney(cobrado),
      pendiente: roundMoney(Math.max(0, pendiente)),
      costos_directos: roundMoney(costosDirectos),
      resultado: roundMoney(cobrado - costosDirectos),
    },
    estado_confianza: estadoConfianza,
    confianza_porcentaje: confianzaPorcentaje,
    nota: conciliacion.resumen.inconsistencias_activas > 0
      ? `${conciliacion.resumen.inconsistencias_activas} registros requieren revisión antes de integrar todo al BI.`
      : 'Póliza conciliada; generado usa fecha económica, no fecha de captura.',
    calidad: {
      total: conciliacion.resumen.total,
      conciliados: conciliacion.resumen.conciliado || 0,
      inconsistencias_activas: conciliacion.resumen.inconsistencias_activas || 0,
      regularizaciones_pendientes: conciliacion.resumen.regularizable || 0,
      revision_manual: conciliacion.resumen.revision_recomendada || 0,
      sin_evidencia: conciliacion.resumen.sin_evidencia || 0,
    },
    fuentes: ['poliza_expedientes', 'solicitudes_inquilino', 'poliza_caja'],
  };
}

export function resumirMantenimientoCentro({
  periodo,
  tickets = [],
  quotes = [],
  cashMovements = [],
  properties = [],
  contracts = [],
}) {
  const conciliacion = construirConciliacionMantenimiento({
    tickets,
    quotes,
    cashMovements,
    properties,
    contracts,
  });

  const casosGeneradosPeriodo = conciliacion.casos.filter((caso) => {
    if (STATUS_MANTENIMIENTO_EXCLUIDOS.has(String(caso.status_operativo || '').toLowerCase())) return false;
    const fechaGeneracion = primeraFecha(
      fechaCotizacionAprobada(caso),
      caso.evidencia?.ticket?.created_at,
    );
    return fechaEnPeriodo(fechaGeneracion, periodo);
  });

  const casosActividadPeriodo = conciliacion.casos.filter((caso) => {
    if (casosGeneradosPeriodo.some((generado) => generado.id === caso.id)) return true;
    if (cajaEnPeriodo(caso.evidencia?.cobros_caja || [], periodo).length > 0) return true;
    if (cajaEnPeriodo(caso.evidencia?.pagos_proveedor || [], periodo).length > 0) return true;
    return fechaEnPeriodo(fechaLiquidacionMantenimiento(caso), periodo);
  });

  const generado = casosGeneradosPeriodo
    .reduce((acc, caso) => acc + toNumber(caso.monto_cobrable), 0);

  const cobrado = casosActividadPeriodo.reduce((acc, caso) => {
    const cobrosPeriodo = sumaEvidenciaCaja(cajaEnPeriodo(caso.evidencia?.cobros_caja || [], periodo));
    const liquidadoPeriodo = fechaEnPeriodo(fechaLiquidacionMantenimiento(caso), periodo)
      ? Math.max(0, toNumber(caso.monto_cobrable) - toNumber(caso.anticipo_registrado))
      : 0;
    return acc + Math.max(cobrosPeriodo, liquidadoPeriodo);
  }, 0);
  const pendiente = casosGeneradosPeriodo.reduce((acc, caso) => acc + toNumber(caso.pendiente_cobro), 0);
  const margenEstimado = casosGeneradosPeriodo.reduce((acc, caso) => acc + toNumber(caso.margen_estimado), 0);
  const costosDirectos = casosActividadPeriodo.reduce((acc, caso) => (
    acc + sumaEvidenciaCaja(cajaEnPeriodo(caso.evidencia?.pagos_proveedor || [], periodo))
  ), 0);

  const totalPeriodo = casosActividadPeriodo.length;
  const conciliadosPeriodo = casosActividadPeriodo.filter((caso) => caso.estado === 'conciliado').length;
  const regularizables = casosActividadPeriodo.filter((caso) => caso.estado === 'regularizable').length;
  const revision = casosActividadPeriodo.filter((caso) => caso.estado === 'revision_recomendada').length;
  const sinEvidencia = casosActividadPeriodo.filter((caso) => caso.estado === 'sin_evidencia').length;
  const inconsistencias = totalPeriodo - conciliadosPeriodo;
  const confianzaPorcentaje = pct(conciliadosPeriodo, totalPeriodo);
  const estadoConfianza = estadoConfianzaDesdePct(confianzaPorcentaje);

  return {
    key: 'mantenimiento',
    label: 'Mantenimiento',
    metricas: {
      generado: roundMoney(generado),
      cobrado: roundMoney(cobrado),
      pendiente: roundMoney(Math.max(0, pendiente)),
      costos_directos: roundMoney(costosDirectos),
      resultado: roundMoney(cobrado - costosDirectos),
      margen_estimado: roundMoney(margenEstimado),
    },
    estado_confianza: estadoConfianza,
    confianza_porcentaje: confianzaPorcentaje,
    nota: inconsistencias > 0
      ? `${inconsistencias} tickets con actividad económica del periodo requieren seguimiento.`
      : 'Mantenimiento conciliado para el periodo.',
    calidad: {
      total: totalPeriodo,
      conciliados: conciliadosPeriodo,
      inconsistencias_activas: inconsistencias,
      regularizaciones_pendientes: regularizables,
      revision_manual: revision,
      sin_evidencia: sinEvidencia,
    },
    fuentes: ['maintenance_tickets', 'maintenance_quotes', 'cash_movements', 'properties', 'contracts'],
  };
}

export function unidadDesdeLecturaBi({ key, label, unidad, resultado, costosDirectos = 0 }) {
  const estado = unidad?.conciliacion?.estado_confianza || ESTADOS_CONFIANZA_BI.NO_DISPONIBLE;
  const diferencias = toNumber(unidad?.conciliacion?.diferencia_cobrado) + toNumber(unidad?.conciliacion?.diferencia_pendiente);
  const requiereRevision = estado === ESTADOS_CONFIANZA_BI.REQUIERE_CONCILIACION;
  const parcial = estado === ESTADOS_CONFIANZA_BI.PARCIAL;
  const registros = Number(unidad?.conciliacion?.registros_revisados || 0);

  return {
    key,
    label,
    metricas: {
      generado: roundMoney(unidad?.metricas?.ingreso_generado),
      cobrado: roundMoney(unidad?.metricas?.cobrado),
      pendiente: roundMoney(unidad?.metricas?.pendiente_reconstruido),
      costos_directos: roundMoney(costosDirectos),
      resultado: roundMoney(resultado ?? (toNumber(unidad?.metricas?.cobrado) - toNumber(costosDirectos))),
    },
    estado_confianza: estado,
    confianza_porcentaje: estado === ESTADOS_CONFIANZA_BI.CALCULABLE ? 100 : parcial ? 80 : requiereRevision ? 60 : 0,
    nota: requiereRevision
      ? 'Tiene diferencias históricas; usar conciliación antes de tomar decisiones finas.'
      : parcial
        ? 'Información calculable con algunos campos pendientes de fecha o trazabilidad.'
        : 'Información calculable desde fuentes conciliadas.',
    calidad: {
      total: registros,
      conciliados: requiereRevision ? 0 : registros,
      inconsistencias_activas: requiereRevision ? registros : 0,
      regularizaciones_pendientes: 0,
      revision_manual: requiereRevision ? registros : 0,
      sin_evidencia: 0,
      diferencia: roundMoney(Math.abs(diferencias)),
    },
    fuentes: unidad?.trazabilidad?.source_tables || [],
  };
}

export function construirCentroInteligencia({ periodo, cierres, administracion, poliza, mantenimiento }) {
  const unidades = [cierres, administracion, poliza, mantenimiento];
  const totalGenerado = roundMoney(unidades.reduce((acc, unidad) => acc + toNumber(unidad.metricas.generado), 0));
  const totalCobrado = roundMoney(unidades.reduce((acc, unidad) => acc + toNumber(unidad.metricas.cobrado), 0));
  const totalPendiente = roundMoney(unidades.reduce((acc, unidad) => acc + toNumber(unidad.metricas.pendiente), 0));
  const resultadoOperativo = roundMoney(unidades.reduce((acc, unidad) => acc + toNumber(unidad.metricas.resultado), 0));
  const costosDirectos = roundMoney(unidades.reduce((acc, unidad) => acc + toNumber(unidad.metricas.costos_directos), 0));
  const confianzaGeneral = pct(
    unidades.reduce((acc, unidad) => acc + toNumber(unidad.confianza_porcentaje), 0),
    unidades.length * 100,
  );
  const estadoConfianza = estadoConfianzaDesdePct(confianzaGeneral);
  const accionesPendientes = unidades.map((unidad) => ({
    key: unidad.key,
    label: unidad.label,
    inconsistencias_activas: unidad.calidad.inconsistencias_activas || 0,
    regularizaciones_pendientes: unidad.calidad.regularizaciones_pendientes || 0,
    revision_manual: unidad.calidad.revision_manual || 0,
    sin_evidencia: unidad.calidad.sin_evidencia || 0,
    nota: unidad.nota,
  })).filter((item) => (
    item.inconsistencias_activas ||
    item.regularizaciones_pendientes ||
    item.revision_manual ||
    item.sin_evidencia
  ));

  return {
    periodo,
    alcance: {
      version: 'Centro Inteligencia V1',
      unidades_incluidas: ['cierres', 'administracion', 'poliza_juridica', 'mantenimiento'],
      unidades_excluidas: ['condominios', 'forecast', 'ia', 'planeacion_anual', 'simuladores'],
      nota: 'Primera lectura ejecutiva consolidada usando únicamente módulos conciliados o en proceso de conciliación.',
    },
    resumen_general: {
      total_generado: totalGenerado,
      total_cobrado: totalCobrado,
      total_pendiente: totalPendiente,
      costos_directos: costosDirectos,
      resultado_operativo: resultadoOperativo,
      resultado_operativo_nota: 'Resultado de las unidades de negocio después de costos directos registrados. No incluye gastos corporativos, impuestos ni nómina administrativa general.',
      estado_confianza: estadoConfianza,
      estado_confianza_label: etiquetaConfianza(estadoConfianza),
      confianza_porcentaje: confianzaGeneral,
    },
    unidades,
    calidad_informacion: {
      confianza_porcentaje: confianzaGeneral,
      estado_confianza: estadoConfianza,
      estado_confianza_label: etiquetaConfianza(estadoConfianza),
      unidades: unidades.map((unidad) => ({
        key: unidad.key,
        label: unidad.label,
        estado_confianza: unidad.estado_confianza,
        estado_confianza_label: etiquetaConfianza(unidad.estado_confianza),
        confianza_porcentaje: unidad.confianza_porcentaje,
        conciliados: unidad.calidad.conciliados || 0,
        total: unidad.calidad.total || 0,
        inconsistencias_activas: unidad.calidad.inconsistencias_activas || 0,
      })),
    },
    acciones_pendientes: accionesPendientes,
  };
}
