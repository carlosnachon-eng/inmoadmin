export const ETAPAS_ARRENDAMIENTO = [
  { orden: 1,  clave: 'apartado',         nombre: 'Apartado registrado',                          responsable: 'ventas' },
  { orden: 2,  clave: 'solicitud_poliza', nombre: 'Solicitud de poliza subida (inquilino)',        responsable: 'ventas' },
  { orden: 3,  clave: 'aviso_dueno',      nombre: 'Aviso al dueno + coordinacion inicial (Majo)', responsable: 'administracion' },
  { orden: 4,  clave: 'investigacion',    nombre: 'Investigacion en proceso',                      responsable: 'juridico' },
  { orden: 5,  clave: 'resultado_poliza', nombre: 'Resultado de investigacion (aprobada/rechazada)', responsable: 'juridico' },
  { orden: 6,  clave: 'contrato',         nombre: 'Contrato de arrendamiento elaborado',           responsable: 'juridico' },
  { orden: 7,  clave: 'habilitacion',     nombre: 'Habilitacion del inmueble (limpieza + inventario)', responsable: 'administracion' },
  { orden: 8,  clave: 'revision_ventas',  nombre: 'Contrato enviado a revision — Ventas lo envia al inquilino', responsable: 'ventas' },
  { orden: 9,  clave: 'revision_majo',    nombre: 'Contrato enviado a revision — Majo lo envia al propietario', responsable: 'administracion' },
  { orden: 10, clave: 'observaciones',    nombre: 'Observaciones resueltas',                       responsable: 'juridico' },
  { orden: 11, clave: 'firma_programada', nombre: 'Firma programada (Juridico + Ventas + Majo)',   responsable: 'juridico' },
  { orden: 12, clave: 'firma_pagos',      nombre: 'Firma realizada + pagos liquidados',            responsable: 'ventas' },
  { orden: 13, clave: 'entrega',          nombre: 'Llaves entregadas + posesion',                  responsable: 'ventas' },
]

export const ETAPAS_COMPRAVENTA = [
  { orden: 1,  clave: 'apartado',         nombre: 'Apartado provisional registrado ($10,000)',     responsable: 'ventas' },
  { orden: 2,  clave: 'datos_comprador',  nombre: 'Datos del comprador subidos',                   responsable: 'ventas' },
  { orden: 3,  clave: 'contrato',         nombre: 'Contrato elaborado segun carta oferta',         responsable: 'juridico' },
  { orden: 4,  clave: 'revision',         nombre: 'Contrato enviado a revision por ambas partes',  responsable: 'juridico' },
  { orden: 5,  clave: 'cambios',          nombre: 'Cambios resueltos + contrato aprobado',         responsable: 'juridico' },
  { orden: 6,  clave: 'promesa_enganche', nombre: 'Firma de promesa + pago de enganche',           responsable: 'direccion' },
  { orden: 7,  clave: 'credito',          nombre: 'Proceso de credito iniciado con broker',        responsable: 'ventas' },
  { orden: 8,  clave: 'avaluo',           nombre: 'Avaluo realizado',                              responsable: 'ventas' },
  { orden: 9,  clave: 'expediente_banco', nombre: 'Expediente ingresado a banco/INFONAVIT',        responsable: 'direccion' },
  { orden: 10, clave: 'escritura',        nombre: 'Firma de escritura + pagos liquidados',         responsable: 'direccion' },
  { orden: 11, clave: 'entrega',          nombre: 'Casa entregada',                                responsable: 'ventas' },
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
  juridico: 'Juridico',
  administracion: 'Administracion (Majo)',
  direccion: 'Direccion',
}

export const STATUS_COLORS = {
  pendiente:   { bg: '#f5f5f5', color: '#888',    label: 'Pendiente' },
  en_proceso:  { bg: '#fff8e1', color: '#f59e0b', label: 'En proceso' },
  completada:  { bg: '#e8f5e9', color: '#22c55e', label: 'Completada' },
  no_aplica:   { bg: '#f5f5f5', color: '#bbb',    label: 'No aplica' },
  bloqueada:   { bg: '#fdecea', color: '#ef4444', label: 'Bloqueada' },
}
