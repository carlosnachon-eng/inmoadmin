/**
 * Catálogo base del Centro de Inteligencia Empresarial.
 *
 * V0-05:
 * - No se importa desde módulos operativos.
 * - No consulta Supabase.
 * - No calcula métricas.
 * - Solo centraliza claves para evitar que futuros módulos reinventen definiciones.
 */

export const UNIDADES_NEGOCIO = Object.freeze({
  CIERRES: 'cierres',
  ADMINISTRACION: 'administracion',
  POLIZA_JURIDICA: 'poliza_juridica',
  MANTENIMIENTO: 'mantenimiento',
  CONDOMINIOS: 'condominios',
  COMERCIAL: 'comercial',
  TESORERIA: 'tesoreria',
  EQUIPO: 'equipo',
  CLIENTES: 'clientes',
  CORPORATIVO: 'corporativo',
  OTROS: 'otros',
});

export const EVENTOS_FINANCIEROS = Object.freeze({
  INGRESO_GENERADO: 'ingreso_generado',
  COBRO_RECIBIDO: 'cobro_recibido',
  CUENTA_POR_COBRAR_CREADA: 'cuenta_por_cobrar_creada',
  CUENTA_POR_COBRAR_LIQUIDADA: 'cuenta_por_cobrar_liquidada',
  FONDO_TERCERO_RECIBIDO: 'fondo_tercero_recibido',
  FONDO_TERCERO_APLICADO: 'fondo_tercero_aplicado',
  COSTO_GENERADO: 'costo_generado',
  PAGO_REALIZADO: 'pago_realizado',
  CUENTA_POR_PAGAR_CREADA: 'cuenta_por_pagar_creada',
  CUENTA_POR_PAGAR_LIQUIDADA: 'cuenta_por_pagar_liquidada',
  RECLASIFICACION: 'reclasificacion',
  AJUSTE: 'ajuste',
  CANCELACION: 'cancelacion',
});

export const EVENTOS_COMERCIALES = Object.freeze({
  VISITA_DIGITAL: 'visita_digital',
  LEAD_CREADO: 'lead_creado',
  CONTACTO_RECIBIDO: 'contacto_recibido',
  CITA_AGENDADA: 'cita_agendada',
  CITA_REALIZADA: 'cita_realizada',
  CITA_CANCELADA: 'cita_cancelada',
  PROPIEDAD_ENVIADA: 'propiedad_enviada',
  APARTADO_REGISTRADO: 'apartado_registrado',
  ABONO_REGISTRADO: 'abono_registrado',
  OPERACION_EN_FIRMA: 'operacion_en_firma',
  CIERRE_CONFIRMADO: 'cierre_confirmado',
  OPORTUNIDAD_PERDIDA: 'oportunidad_perdida',
  RENOVACION_DETECTADA: 'renovacion_detectada',
});

export const EVENTOS_OPERATIVOS = Object.freeze({
  TAREA_CREADA: 'tarea_creada',
  TAREA_COMPLETADA: 'tarea_completada',
  ETAPA_INICIADA: 'etapa_iniciada',
  ETAPA_COMPLETADA: 'etapa_completada',
  DOCUMENTO_SOLICITADO: 'documento_solicitado',
  DOCUMENTO_RECIBIDO: 'documento_recibido',
  DOCUMENTO_GENERADO: 'documento_generado',
  TICKET_CREADO: 'ticket_creado',
  COTIZACION_EMITIDA: 'cotizacion_emitida',
  COTIZACION_APROBADA: 'cotizacion_aprobada',
  TICKET_CERRADO: 'ticket_cerrado',
  INCIDENCIA_DETECTADA: 'incidencia_detectada',
  CONCILIACION_REVISADA: 'conciliacion_revisada',
});

export const DIRECCIONES_EVENTO = Object.freeze({
  ENTRADA: 'entrada',
  SALIDA: 'salida',
  NEUTRAL: 'neutral',
});

export const ESTADOS_NORMALIZADOS = Object.freeze({
  BORRADOR: 'borrador',
  PENDIENTE: 'pendiente',
  EN_PROCESO: 'en_proceso',
  PARCIAL: 'parcial',
  CONFIRMADO: 'confirmado',
  COBRADO: 'cobrado',
  PAGADO: 'pagado',
  VENCIDO: 'vencido',
  CANCELADO: 'cancelado',
  CERRADO: 'cerrado',
  CONCILIADO: 'conciliado',
  REQUIERE_REVISION: 'requiere_revision',
  DESCONOCIDO: 'desconocido',
});

export const CLASIFICACIONES_ECONOMICAS = Object.freeze({
  INGRESO_PROPIO: 'ingreso_propio',
  FONDOS_TERCEROS: 'fondos_terceros',
  COSTO: 'costo',
  CUENTA_POR_COBRAR: 'cuenta_por_cobrar',
  CUENTA_POR_PAGAR: 'cuenta_por_pagar',
  PIPELINE: 'pipeline',
  EVIDENCIA: 'evidencia',
  RECLASIFICACION: 'reclasificacion',
  NO_FINANCIERO: 'no_financiero',
  AJUSTE: 'ajuste',
});
