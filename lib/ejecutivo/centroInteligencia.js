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
      .filter((expediente) => fechaEnPeriodo(expediente.created_at || expediente.updated_at, periodo))
      .map((expediente) => String(expediente.id)),
  );
  const idsSolicitudesGeneradas = new Set(
    solicitudes
      .filter((solicitud) => fechaEnPeriodo(solicitud.created_at || solicitud.fecha_solicitud || solicitud.updated_at, periodo))
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
    },
    estado_confianza: estadoConfianza,
    confianza_porcentaje: confianzaPorcentaje,
    nota: conciliacion.resumen.inconsistencias_activas > 0
      ? `${conciliacion.resumen.inconsistencias_activas} registros requieren revisión antes de integrar todo al BI.`
      : 'Póliza conciliada con caja jurídica vinculada.',
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

  const casosPeriodo = conciliacion.casos.filter((caso) => {
    const createdAt = caso.evidencia?.ticket?.created_at;
    const updatedAt = caso.evidencia?.ticket?.updated_at;
    return fechaEnPeriodo(createdAt || updatedAt, periodo) || fechaEnPeriodo(updatedAt, periodo);
  });

  const generado = casosPeriodo
    .filter((caso) => !STATUS_MANTENIMIENTO_EXCLUIDOS.has(String(caso.status_operativo || '').toLowerCase()))
    .reduce((acc, caso) => acc + toNumber(caso.monto_cobrable), 0);

  const cobrado = casosPeriodo.reduce((acc, caso) => acc + toNumber(caso.cobrado_trazable), 0);
  const pendiente = casosPeriodo.reduce((acc, caso) => acc + toNumber(caso.pendiente_cobro), 0);
  const margenEstimado = casosPeriodo.reduce((acc, caso) => acc + toNumber(caso.margen_estimado), 0);

  const totalPeriodo = casosPeriodo.length;
  const conciliadosPeriodo = casosPeriodo.filter((caso) => caso.estado === 'conciliado').length;
  const regularizables = casosPeriodo.filter((caso) => caso.estado === 'regularizable').length;
  const revision = casosPeriodo.filter((caso) => caso.estado === 'revision_recomendada').length;
  const sinEvidencia = casosPeriodo.filter((caso) => caso.estado === 'sin_evidencia').length;
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
      margen_estimado: roundMoney(margenEstimado),
    },
    estado_confianza: estadoConfianza,
    confianza_porcentaje: confianzaPorcentaje,
    nota: inconsistencias > 0
      ? `${inconsistencias} tickets siguen abiertos o requieren evidencia de cobro/proveedor.`
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

export function unidadDesdeLecturaBi({ key, label, unidad }) {
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
      neto_emporio: null,
      neto_emporio_estado: 'en_validacion',
      neto_emporio_nota: 'Neto para Emporio queda en validación hasta homologar costos, fondos de terceros y margen por unidad.',
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
