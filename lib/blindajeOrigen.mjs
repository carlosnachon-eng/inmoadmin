// Informational capture only; never use this self-declared value for authorization
// or to resolve an advisor, property, operation, or expediente.
export function hasPartnerCandidate(query = {}) {
  return Boolean(query.partner && query.operacion)
}

export function partnerCandidateKey(query = {}) {
  return JSON.stringify([query.partner, query.operacion])
}

// A response only validates the exact URL candidate that requested it.
export function validatedPartnerResponse(query, data) {
  return typeof query.partner === 'string' && typeof query.operacion === 'string'
    && Boolean(query.partner && query.operacion)
    && data?.operation?.id === query.operacion
    && data?.agency?.id === query.partner && data.agency.status === 'activo'
}

export function partnerContextStatus(query, validation) {
  if (!hasPartnerCandidate(query)) return 'none'
  if (validation?.key !== partnerCandidateKey(query)) return 'pending'
  return validation.status === 'valid' ? 'valid' : 'invalid'
}

export function needsOrigenStep(enabled, ready, partnerStatus, selection) {
  return enabled && ready && ['none', 'invalid'].includes(partnerStatus) && !selection
}

export function shouldLinkPartner(enabled, query, partnerStatus) {
  return enabled ? partnerStatus === 'valid' : hasPartnerCandidate(query)
}

export function origenMetadata(enabled, partnerStatus, selection) {
  if (!enabled) return {}
  if (partnerStatus === 'pending') throw new Error('Espera la validación de la operación Partner.')
  if (partnerStatus === 'valid') return { origen_operacion: 'partner', asesor_referencia: null }
  if (!selection || !['emporio', 'b2c'].includes(selection.origen_operacion)) {
    throw new Error('Selecciona el origen de la operación antes de continuar.')
  }
  return {
    origen_operacion: selection.origen_operacion,
    asesor_referencia: selection.origen_operacion === 'emporio'
      ? selection.asesor_referencia?.trim() || null : null,
  }
}
