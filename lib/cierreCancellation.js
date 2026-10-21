export const cierreVigente = cierre => cierre.estado !== 'cancelado';
export const motivoCancelacionValido = value => typeof value === 'string' && value.trim().length >= 10 && value.trim().length <= 1000;
export function cancellationError(error) {
 const messages = {
  devolucion_referencia_duplicada: 'Esa referencia de devolución ya está registrada. No se duplicó el egreso.',
  devolucion_invalida: 'La devolución parcial debe ser mayor que cero y menor que el cobro, con máximo dos decimales.',
  fecha_devolucion_invalida: 'La fecha de devolución debe ser real, no futura y no anterior al último cobro.',
  referencia_devolucion_invalida: 'Escribe una referencia de la devolución de 10 a 250 caracteres.',
  retencion_invalida: 'El importe retenido debe ser positivo y tener como máximo dos decimales.',
  retencion_desactualizada: 'El cobro cambió o no coincide con los pagos registrados. Actualiza y concilia antes de cancelar.',
  comisiones_pagadas_requieren_conciliacion: 'Ya hay comisiones pagadas. Requiere conciliación; no se canceló.',
  cancelacion_tipo_distinto: 'El cierre ya tiene otro tratamiento de cancelación. Consulta su historial.',
  solo_admin: 'Sólo un administrador activo puede cancelar un cierre.',
  motivo_invalido: 'Escribe un motivo de entre 10 y 1000 caracteres.',
  cobros_requieren_conciliacion: 'Este cierre tiene cobros o pagos registrados. Requiere conciliación; no se canceló.',
  origen_cierre_duplicado: 'Hay otro cierre activo con el mismo recibo o firma. Requiere revisión administrativa; no se canceló.',
  cierre_no_encontrado: 'No se encontró el cierre.',
 };
 return messages[error?.message] || 'No se pudo cancelar el cierre. Actualiza y consulta su estado antes de volver a intentarlo.';
}

export function devolucionParcialValida({importe,monto,fecha,referencia}, hoy) {
 const n=Number(monto), total=Number(importe);
 return Number.isFinite(n) && Number.isFinite(total) && n>0 && n<total
  && Math.abs(n*100-Math.round(n*100))<0.000001
  && typeof fecha==='string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
  && !Number.isNaN(Date.parse(fecha)) && new Date(fecha).toISOString().slice(0,10)===fecha && fecha<=hoy
  && typeof referencia==='string' && referencia.trim().length>=10 && referencia.trim().length<=250;
}
