export const ETAPAS_ARRENDAMIENTO = [
  { orden: 1,  clave: 'apartado',         nombre: 'Apartado registrado',                          responsable: 'ventas' },
  { orden: 2,  clave: 'solicitud_poliza', nombre: 'Solicitud de póliza subida (inquilino)',        responsable: 'ventas' },
  { orden: 3,  clave: 'aviso_dueno',      nombre: 'Aviso al propietario + coordinación inicial',   responsable: 'administracion' },
  { orden: 4,  clave: 'investigacion',    nombre: 'Investigación en proceso',                      responsable: 'juridico' },
  { orden: 5,  clave: 'resultado_poliza', nombre: 'Resultado de investigación',                    responsable: 'juridico' },
  { orden: 6,  clave: 'contrato',         nombre: 'Contrato de arrendamiento elaborado',           responsable: 'juridico' },
  { orden: 7,  clave: 'revision_ventas',  nombre: 'Contrato enviado a revisión — Ventas lo envía al inquilino', responsable: 'ventas' },
  { orden: 8,  clave: 'revision_majo',    nombre: 'Contrato enviado a revisión — Administración lo envía al propietario', responsable: 'administracion' },
  { orden: 9,  clave: 'observaciones',    nombre: 'Observaciones resueltas',                       responsable: 'juridico' },
  { orden: 10, clave: 'firma_programada', nombre: 'Firma programada',                              responsable: 'juridico' },
  { orden: 11, clave: 'coordinacion_entrega', nombre: 'Coordinación de Entrega',                   responsable: 'administracion' },
  { orden: 12, clave: 'firma_pagos',      nombre: 'Firma realizada + pagos liquidados',            responsable: 'ventas' },
  { orden: 13, clave: 'entrega',          nombre: 'Entrega del inmueble',                          responsable: 'asesor' },
  { orden: 14, clave: 'contrato_firmado_subido', nombre: 'Contrato firmado subido al expediente',  responsable: 'administracion' },
  { orden: 15, clave: 'seguimiento_post_entrega', nombre: 'Seguimiento post entrega',              responsable: 'administracion' },
  { orden: 16, clave: 'expediente_concluido', nombre: 'Expediente concluido',                      responsable: 'automatico' },
]

export const ETAPAS_COMPRAVENTA = [
  { orden: 1,  clave: 'apartado',              nombre: 'Apartado provisional registrado',       responsable: 'ventas' },
  { orden: 2,  clave: 'datos_comprador',       nombre: 'Datos del comprador subidos',           responsable: 'ventas' },
  { orden: 3,  clave: 'contrato',              nombre: 'Contrato elaborado según carta oferta', responsable: 'juridico' },
  { orden: 4,  clave: 'revision',              nombre: 'Contrato enviado a revisión por ambas partes', responsable: 'juridico' },
  { orden: 5,  clave: 'cambios',               nombre: 'Cambios resueltos + contrato aprobado', responsable: 'juridico' },
  { orden: 6,  clave: 'promesa_enganche',      nombre: 'Promesa / contrato',                    responsable: 'direccion' },
  { orden: 7,  clave: 'credito',               nombre: 'Proceso de crédito iniciado con broker', responsable: 'ventas' },
  { orden: 8,  clave: 'avaluo',                nombre: 'Avalúo realizado',                      responsable: 'ventas' },
  { orden: 9,  clave: 'expediente_banco',      nombre: 'Expediente ingresado a banco/INFONAVIT', responsable: 'direccion' },
  { orden: 10, clave: 'escritura',             nombre: 'Firma de escritura',                    responsable: 'direccion' },
  { orden: 11, clave: 'coordinacion_entrega',  nombre: 'Coordinación de Entrega',               responsable: 'administracion' },
  { orden: 12, clave: 'entrega',               nombre: 'Entrega del inmueble',                  responsable: 'asesor' },
  { orden: 13, clave: 'acta_entrega_subida',   nombre: 'Acta de entrega firmada subida',        responsable: 'administracion' },
  { orden: 14, clave: 'seguimiento_postventa', nombre: 'Seguimiento postventa',                 responsable: 'administracion' },
  { orden: 15, clave: 'expediente_concluido',  nombre: 'Expediente concluido',                  responsable: 'automatico' },
]

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
  administracion: 'Administración (Tania)',
  direccion: 'Dirección',
  asesor: 'Asesor',
  automatico: 'Automático',
}

export const STATUS_COLORS = {
  pendiente:   { bg: '#f5f5f5', color: '#888',    label: 'Pendiente' },
  en_proceso:  { bg: '#fff8e1', color: '#f59e0b', label: 'En proceso' },
  completada:  { bg: '#e8f5e9', color: '#22c55e', label: 'Completada' },
  no_aplica:   { bg: '#f5f5f5', color: '#bbb',    label: 'No aplica' },
  bloqueada:   { bg: '#fdecea', color: '#ef4444', label: 'Bloqueada' },
}
