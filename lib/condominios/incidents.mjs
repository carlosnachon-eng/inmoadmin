export const INCIDENT_EVIDENCE_BUCKET = "condominium-incident-evidence";
export const INCIDENT_STATUSES = ["nuevo", "revisado", "cotizado", "aprobado", "en_proceso", "en_espera", "terminado", "cerrado", "cancelado"];
export const INCIDENT_PRIORITIES = ["baja", "media", "alta", "urgente"];
export const INCIDENT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const INCIDENT_MAX_FILE_BYTES = 5 * 1024 * 1024;

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export function validateIncidentInput(input = {}) {
  if (!isUuid(input.condominioId) || !isUuid(input.unidadId)) return "INVALID_SCOPE";
  if (!isUuid(input.idempotencyKey)) return "INVALID_IDEMPOTENCY_KEY";
  if (String(input.title || "").trim().length < 3 || String(input.title || "").trim().length > 160) return "INVALID_TITLE";
  if (String(input.description || "").trim().length < 5 || String(input.description || "").trim().length > 4000) return "INVALID_DESCRIPTION";
  if (input.categoryId && !isUuid(input.categoryId)) return "INVALID_CATEGORY";
  if (input.priority && !INCIDENT_PRIORITIES.includes(input.priority)) return "INVALID_PRIORITY";
  return null;
}

export function validateIncidentEvidence(evidence) {
  if (!evidence) return null;
  if (!INCIDENT_MIME_TYPES.includes(evidence.mimeType)) return "INVALID_EVIDENCE_TYPE";
  const bytes = Buffer.from(String(evidence.base64 || ""), "base64");
  if (!bytes.length || bytes.length > INCIDENT_MAX_FILE_BYTES) return "INVALID_EVIDENCE_SIZE";
  return null;
}

export function incidentEvidencePath({ condominioId, ticketId, evidenceId, mimeType }) {
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mimeType];
  if (![condominioId, ticketId, evidenceId].every(isUuid) || !ext) return null;
  return `${condominioId}/${ticketId}/${evidenceId}.${ext}`;
}

export function incidentErrorCode(error) {
  const message = String(error?.message || "");
  for (const code of ["OPERATION_NOT_ALLOWED", "UNIT_ACCESS_DENIED", "INVALID_TRANSITION", "DUPLICATE_INCIDENT", "TICKET_NOT_FOUND", "CATEGORY_NOT_ALLOWED"]) {
    if (message.includes(code)) return code;
  }
  return "INCIDENT_OPERATION_FAILED";
}
