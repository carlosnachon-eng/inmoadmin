export const cierreVigente = cierre => cierre.estado !== 'cancelado';
export const motivoCancelacionValido = value => typeof value === 'string' && value.trim().length >= 10 && value.trim().length <= 1000;
export function cancellationError(error) {
 const messages = {
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
