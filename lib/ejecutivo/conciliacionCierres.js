export const TOLERANCIA_CONCILIACION = 0.009;

export const ESTADOS_CONCILIACION_CIERRES = {
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

export const redondearMoneda = (value) => Math.round(Number(value || 0) * 100) / 100;

export const dineroIgual = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) <= TOLERANCIA_CONCILIACION;

export const sumarMontos = (items = [], campo = 'monto') =>
  redondearMoneda(items.reduce((sum, item) => sum + Number(item?.[campo] || 0), 0));

export function construirEvidenciaRecibo(recibo) {
  if (!recibo?.id) return null;

  const abonos = [...(recibo.recibos_abonos || [])].sort((a, b) =>
    new Date(a.created_at || a.fecha || 0) - new Date(b.created_at || b.fecha || 0)
  );

  const componentes = [
    {
      tipo: 'recibo_inicial',
      id: recibo.id,
      marcador: `recibo_inicial:${recibo.id}`,
      monto: Number(recibo.monto || 0),
      fecha: recibo.fecha || String(recibo.created_at || new Date().toISOString()).slice(0, 10),
      metodo_pago: recibo.forma_pago || 'transferencia',
      descripcion: `Recibo inicial ${recibo.folio || recibo.id}`,
    },
    ...abonos.map((abono) => ({
      tipo: 'recibo_abono',
      id: abono.id,
      marcador: `recibo_abono:${abono.id}`,
      monto: Number(abono.monto || 0),
      fecha: abono.fecha || String(abono.created_at || new Date().toISOString()).slice(0, 10),
      metodo_pago: abono.forma_pago || 'transferencia',
      descripcion: `Abono ${abono.id}`,
    })),
  ].filter((componente) => componente.monto > 0);

  return {
    tipo: 'recibo_apartado',
    recibo_id: recibo.id,
    folio: recibo.folio || null,
    total_componentes: sumarMontos(componentes),
    monto_total_acordado: Number(recibo.monto_total_acordado || 0),
    componentes,
    descripcion: [
      recibo.folio ? `Folio ${recibo.folio}` : null,
      recibo.cliente_nombre ? `Cliente ${recibo.cliente_nombre}` : null,
      recibo.inmueble ? `Inmueble ${recibo.inmueble}` : null,
    ].filter(Boolean).join(' · '),
  };
}

export function detectarComponentesFaltantes({ pagos = [], evidenciaRecibo }) {
  if (!evidenciaRecibo?.componentes?.length) return [];

  return evidenciaRecibo.componentes.filter((componente) => {
    const marcador = componente.marcador;
    return !pagos.some((pago) => String(pago.notas || '').includes(marcador));
  });
}

export function clasificarConciliacionCierre({ cierre, pagos = [], recibo = null, ignorado = null }) {
  const cobradoSistema = redondearMoneda(cierre?.cobrado || 0);
  const cobradoTrazable = sumarMontos(pagos);
  const diferencia = redondearMoneda(cobradoSistema - cobradoTrazable);
  const comision = redondearMoneda(cierre?.comision || 0);
  const pendienteReconstruido = redondearMoneda(Math.max(0, comision - cobradoTrazable));

  if (ignorado) {
    return {
      estado: 'ignorado',
      causa_probable: ignorado.motivo || 'Caso marcado como ignorado por Dirección.',
      accion_sugerida: 'No mostrar como pendiente. Se conserva para auditoría.',
      evidencia: {
        nivel: 'ignorado',
        descripcion: ignorado.motivo || 'Ignorado manualmente',
        ignorado,
      },
      regularizacion: null,
      pendiente_reconstruido: pendienteReconstruido,
      diferencia,
    };
  }

  if (dineroIgual(diferencia, 0)) {
    return {
      estado: 'conciliado',
      causa_probable: 'El cobrado del cierre coincide con los pagos trazables.',
      accion_sugerida: 'Sin acción requerida.',
      evidencia: {
        nivel: 'conciliado',
        descripcion: 'cierres.cobrado coincide con SUM(cierre_pagos.monto).',
      },
      regularizacion: null,
      pendiente_reconstruido: pendienteReconstruido,
      diferencia,
    };
  }

  if (diferencia < 0) {
    return {
      estado: 'revision_recomendada',
      causa_probable: 'Existen más pagos trazables que cobrado registrado en el cierre.',
      accion_sugerida: 'Revisar manualmente antes de modificar el resumen del cierre.',
      evidencia: {
        nivel: 'parcial',
        descripcion: 'Hay pagos en cierre_pagos superiores al cobrado del cierre.',
      },
      regularizacion: null,
      pendiente_reconstruido: pendienteReconstruido,
      diferencia,
    };
  }

  const evidenciaRecibo = construirEvidenciaRecibo(recibo);
  const componentesFaltantes = detectarComponentesFaltantes({ pagos, evidenciaRecibo });
  const totalFaltanteRecibo = sumarMontos(componentesFaltantes);
  const reciboCuadraConCierre = evidenciaRecibo
    && (dineroIgual(evidenciaRecibo.total_componentes, cobradoSistema)
      || dineroIgual(evidenciaRecibo.monto_total_acordado, cobradoSistema));
  const faltanteCuadra = dineroIgual(totalFaltanteRecibo, diferencia);
  const yaRegularizado = pagos.some((pago) =>
    String(pago.concepto || '') === 'regularizacion_historica'
      || String(pago.notas || '').includes(`regularizacion_historica:${cierre.id}`)
  );

  if (reciboCuadraConCierre && faltanteCuadra && !yaRegularizado) {
    const primerComponente = componentesFaltantes[0] || evidenciaRecibo.componentes[0];
    const marcadores = componentesFaltantes.map((c) => c.marcador).join(',');
    return {
      estado: 'regularizable',
      causa_probable: 'El cierre tiene recibo vinculado y faltan componentes exactos en cierre_pagos.',
      accion_sugerida: 'Puede crear pago de regularización histórica con trazabilidad al recibo.',
      evidencia: {
        nivel: 'fuerte',
        descripcion: evidenciaRecibo.descripcion || `Recibo ${evidenciaRecibo.folio || evidenciaRecibo.recibo_id}`,
        recibo: evidenciaRecibo,
        componentes_faltantes: componentesFaltantes,
      },
      regularizacion: {
        monto: diferencia,
        fecha: primerComponente?.fecha || cierre.fecha_cierre || new Date().toISOString().slice(0, 10),
        metodo_pago: String(primerComponente?.metodo_pago || 'transferencia').toLowerCase().includes('efectivo')
          ? 'efectivo'
          : 'transferencia',
        marcador: `regularizacion_historica:${cierre.id}:${evidenciaRecibo.recibo_id}:${marcadores}`,
        origen: `recibo_apartado:${evidenciaRecibo.recibo_id}`,
        descripcion: `Componentes faltantes: ${componentesFaltantes.map((c) => c.descripcion).join(' + ')}`,
      },
      pendiente_reconstruido: pendienteReconstruido,
      diferencia,
    };
  }

  if (evidenciaRecibo) {
    return {
      estado: 'revision_recomendada',
      causa_probable: 'Existe recibo vinculado, pero el monto faltante no cuadra exactamente con la evidencia.',
      accion_sugerida: 'Revisar manualmente antes de regularizar.',
      evidencia: {
        nivel: 'parcial',
        descripcion: evidenciaRecibo.descripcion || `Recibo ${evidenciaRecibo.folio || evidenciaRecibo.recibo_id}`,
        recibo: evidenciaRecibo,
        componentes_faltantes: componentesFaltantes,
      },
      regularizacion: null,
      pendiente_reconstruido: pendienteReconstruido,
      diferencia,
    };
  }

  return {
    estado: 'sin_evidencia',
    causa_probable: 'El cobrado fue capturado o editado en cierres sin respaldo suficiente en cierre_pagos.',
    accion_sugerida: 'Requiere revisión manual. No se permite regularización automática.',
    evidencia: {
      nivel: 'sin_evidencia',
      descripcion: 'No hay recibo vinculado ni evidencia fuerte suficiente.',
    },
    regularizacion: null,
    pendiente_reconstruido: pendienteReconstruido,
    diferencia,
  };
}

export function construirResumenConciliacion(items = []) {
  return items.reduce((acc, item) => {
    acc.total_revisados += 1;
    acc[item.estado] = (acc[item.estado] || 0) + 1;
    if (item.estado !== 'conciliado' && item.estado !== 'ignorado') acc.total_inconsistencias += 1;
    if (item.estado !== 'conciliado') acc.monto_diferencia += Number(item.diferencia || 0);
    return acc;
  }, {
    total_revisados: 0,
    total_inconsistencias: 0,
    regularizable: 0,
    revision_recomendada: 0,
    sin_evidencia: 0,
    conciliado: 0,
    ignorado: 0,
    monto_diferencia: 0,
  });
}
