// Informational capture only; never use this self-declared value for authorization
// or to resolve an advisor, property, operation, or expediente.
export function hasPartnerContext(query = {}) {
  return Boolean(query.partner && query.operacion)
}

export function needsOrigenStep(enabled, ready, query, selection) {
  return enabled && ready && !hasPartnerContext(query) && !selection
}

export function origenMetadata(enabled, query, selection) {
  if (!enabled) return {}
  if (hasPartnerContext(query)) return { origen_operacion: 'partner', asesor_referencia: null }
  if (!selection || !['emporio', 'b2c'].includes(selection.origen_operacion)) {
    throw new Error('Selecciona el origen de la operación antes de continuar.')
  }
  return {
    origen_operacion: selection.origen_operacion,
    asesor_referencia: selection.origen_operacion === 'emporio'
      ? selection.asesor_referencia?.trim() || null : null,
  }
}
