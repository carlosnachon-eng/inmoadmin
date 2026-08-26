const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ENTITY_TO_IDENTIFIER = Object.freeze({
  contact_identity: "clientIdentityId",
  property: "propertyId",
  contract: "contractId",
  payment: "paymentId",
  service: "serviceId",
  maintenance_ticket: "ticketId",
  key: "keyId",
  owner_liquidation: "ownerPaymentId",
  work_center_case: "workCenterContextKey",
});

const UUID_IDENTIFIERS = Object.freeze([
  "clientIdentityId", "propertyId", "contractId", "paymentId", "serviceId", "ticketId", "quoteId", "keyId", "ownerPaymentId",
]);

const cleanUuid = (value) => UUID_PATTERN.test(String(value || "").trim()) ? String(value).trim() : null;
const cleanReference = (value) => {
  const text = String(value || "").trim();
  return text && text.length <= 120 ? text : null;
};

const uniqueEvidenceId = (toolResults, entityType) => {
  const ids = [...new Set((toolResults || []).filter((tool) => tool.ok).flatMap((tool) => tool.result || [])
    .filter((row) => row.entityType === entityType)
    .map((row) => row.internalId || row.id || row.contextKey)
    .filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
};

const uniqueResolvedId = (resolvedEntities, entityType) => {
  const ids = [...new Set((resolvedEntities || []).filter((entity) => entity.entityType === entityType)
    .map((entity) => entity.internalId).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
};

/**
 * Fuente server-side única de identificadores operativos. No recibe ni consulta
 * goldens: sólo metadata autorizada, contexto previamente persistido, entidades
 * resueltas y evidencia de tools read-only.
 */
export function buildResolvedOperationalContext({ metadata = {}, persistedContext = {}, resolvedEntities = [], toolResults = [] } = {}) {
  const context = {};
  const respondContactId = cleanReference(metadata.respondContactId || persistedContext.respondContactId);
  if (respondContactId) context.respondContactId = respondContactId;
  for (const [entityType, identifier] of Object.entries(ENTITY_TO_IDENTIFIER)) {
    const candidate = uniqueEvidenceId(toolResults, entityType)
      || uniqueResolvedId(resolvedEntities, entityType)
      || metadata[identifier]
      || persistedContext[identifier];
    const validated = identifier === "workCenterContextKey" ? cleanReference(candidate) : cleanUuid(candidate);
    if (validated) context[identifier] = validated;
  }
  const propertyReference = cleanReference(metadata.propertyReference || persistedContext.propertyReference);
  if (propertyReference) context.propertyReference = propertyReference;
  const serviceType = cleanReference(metadata.serviceType || metadata.service || persistedContext.serviceType);
  if (serviceType) context.serviceType = serviceType.toLowerCase();
  const period = cleanReference(metadata.period || persistedContext.period);
  if (period) context.period = period;
  const quoteId = cleanUuid(metadata.quoteId || persistedContext.quoteId);
  if (quoteId) context.quoteId = quoteId;
  for (const key of ["eventType", "maintenanceScope", "status", "priority", "payer", "occurredAt"]) {
    const value = cleanReference(metadata[key] || persistedContext[key]);
    if (value) context[key] = value;
  }
  for (const key of ["amount", "providerCost"]) {
    const value = metadata[key] ?? persistedContext[key];
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) context[key] = Number(value);
  }
  return context;
}

export function contextIdentifierKeys(context = {}) {
  return [...UUID_IDENTIFIERS, "workCenterContextKey"].filter((key) => Boolean(context[key]));
}
