// lib/firmasEtapas.js
// Define las etapas según tipo de operación

export const ETAPAS_ARRENDAMIENTO = [
  { orden: 1,  clave: 'apartado',         nombre: 'Apartado registrado',                          responsable: 'ventas' },
  { orden: 2,  clave: 'poliza_aviso',     nombre: 'Solicitud de póliza subida + aviso al dueño',  responsable: 'coordinacion' },
  { orden: 3,  clave: 'investigacion',    nombre: 'Investigación en proceso',                      responsable: 'juridico' },
  { orden: 4,  clave: 'resultado_poliza', nombre: 'Resultado de investigación (aprobada/rechazada)', responsable: 'juridico' },
  { orden: 5,  clave: 'contrato',         nombre: 'Contrato de arrendamiento elaborado',           responsable: 'juridico' },
  { orden: 6,  clave: 'habilitacion',     nombre: 'Habilitación del inmueble (limpieza + inventario)', responsable: 'administracion' },
  { orden: 7,  clave: 'revision',         nombre: 'Contrato enviado a revisión por ambas partes', responsable: 'juridico' },
  { orden: 8,  clave: 'firma_programada', nombre: 'Observaciones resueltas + firma programada',   responsable: 'coordinacion' },
  { orden: 9,  clave: 'firma_pagos',      nombre: 'Firma realizada + pagos liquidados',            responsable: 'administracion' },
  { orden: 10, clave: 'entrega',          nombre: 'Llaves entregadas + posesión',                  responsable: 'coordinacion' },
]

export const ETAPAS_COMPRAVENTA = [
  { orden: 1,  clave: 'apartado',         nombre: 'Apartado provisional registrado ($10,000)',     responsable: 'ventas' },
  { orden: 2,  clave: 'datos_comprador',  nombre: 'Datos del comprador subidos',                   responsable: 'ventas' },
  { orden: 3,  clave: 'contrato',         nombre: 'Contrato elaborado según carta oferta',         responsable: 'juridico' },
  { orden: 4,  clave: 'revision',         nombre: 'Contrato enviado a revisión por ambas partes',  responsable: 'juridico' },
  { orden: 5,  clave: 'cambios',          nombre: 'Cambios resueltos + contrato aprobado',         responsable: 'juridico' },
  { orden: 6,  clave: 'promesa_enganche', nombre: 'Firma de promesa + pago de enganche',           responsable: 'coordinacion' },
  { orden: 7,  clave: 'credito',          nombre: 'Proceso de crédito iniciado con broker',        responsable: 'ventas' },
  { orden: 8,  clave: 'avaluo',           nombre: 'Avalúo realizado',                              responsable: 'ventas' },
  { orden: 9,  clave: 'expediente_banco', nombre: 'Expediente ingresado a banco/INFONAVIT',        responsable: 'direccion' },
  { orden: 10, clave: 'escritura',        nombre: 'Firma de escritura + pagos liquidados',         responsable: 'coordinacion' },
  { orden: 11, clave: 'entrega',          nombre: 'Casa entregada',                                responsable: 'coordinacion' },
]

// Etapas que se omiten en compraventa de contado
export const ETAPAS_CONTADO_OMITIR = [7, 8, 9]

export function getEtapas(tipo, esContado = false) {
  const etapas = tipo === 'arrendamiento'
    ? ETAPAS_ARRENDAMIENTO
    : ETAPAS_COMPRAVENTA

  return etapas.map(e => ({
    ...e,
    status: (tipo === 'compraventa' && esContado && ETAPAS_CONTADO_OMITIR.includes(e.orden))
      ? 'no_aplica'
      : 'pendiente'
  }))
}

export const RESPONSABLE_LABELS = {
  ventas: 'Ventas',
  juridico: 'Jurídico',
  administracion: 'Administración',
  coordinacion: 'Coordinación (Majo)',
  direccion: 'Dirección',
}

export const STATUS_COLORS = {
  pendiente:   { bg: '#f5f5f5', color: '#888',    label: 'Pendiente' },
  en_proceso:  { bg: '#fff8e1', color: '#f59e0b', label: 'En proceso' },
  completada:  { bg: '#e8f5e9', color: '#22c55e', label: 'Completada' },
  no_aplica:   { bg: '#f5f5f5', color: '#bbb',    label: 'No aplica' },
  bloqueada:   { bg: '#fdecea', color: '#ef4444', label: 'Bloqueada' },
}
