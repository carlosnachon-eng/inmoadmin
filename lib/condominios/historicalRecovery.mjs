export const HISTORICAL_RECOVERY_STATUSES = Object.freeze({
  pending: "PENDIENTE_APLICACION",
  applied: "APLICADO",
  reversed: "REVERSADO",
});

export const HISTORICAL_EVIDENCE_BUCKET = "condominium-historical-evidence";
export const MAX_HISTORICAL_EVIDENCE_BYTES = 5 * 1024 * 1024;

const MIME_EXTENSION = Object.freeze({
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
});

// PostgreSQL acepta el formato UUID canónico aunque los fixtures históricos no
// codifiquen versión/variante RFC. La base y las consultas de alcance siguen
// siendo la autoridad para validar la existencia y relación de cada UUID.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

export function evidenceExtension(mimeType) {
  return MIME_EXTENSION[String(mimeType || "").toLowerCase()] || null;
}

export function historicalEvidencePath({ condominioId, unidadId, recoveryId, mimeType }) {
  const extension = evidenceExtension(mimeType);
  if (![condominioId, unidadId, recoveryId].every(isUuid) || !extension) return null;
  return `${condominioId}/${unidadId}/${recoveryId}.${extension}`;
}

export function decodeEvidenceBase64(value) {
  const raw = String(value || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.length || bytes.length > MAX_HISTORICAL_EVIDENCE_BYTES) return null;
  return bytes;
}

export function evidenceMatchesMime(bytes, mimeType) {
  if (!Buffer.isBuffer(bytes)) return false;
  if (mimeType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return false;
}

export function validateRecoveryCreateInput(payload = {}) {
  const amount = Number(payload.amount);
  const depositTotal = Number(payload.depositTotal);
  if (![payload.condominioId, payload.unidadId, payload.historicalAccountId, payload.idempotencyKey].every(isUuid)) return "INVALID_SCOPE";
  if (!Number.isFinite(amount) || amount <= 0) return "INVALID_AMOUNT";
  if (!Number.isFinite(depositTotal) || depositTotal < amount) return "INVALID_DEPOSIT_TOTAL";
  if (String(payload.paymentReference || "").trim().length < 3) return "INVALID_REFERENCE";
  if (!payload.proofReceivedAt || Number.isNaN(Date.parse(payload.proofReceivedAt))) return "INVALID_PROOF_DATE";
  if (payload.currentFeeId && !isUuid(payload.currentFeeId)) return "INVALID_CURRENT_FEE";
  if (!payload.evidence || !evidenceExtension(payload.evidence.mimeType)) return "INVALID_EVIDENCE_TYPE";
  const evidenceBytes = decodeEvidenceBase64(payload.evidence.base64);
  if (!evidenceBytes || !evidenceMatchesMime(evidenceBytes, payload.evidence.mimeType)) return "INVALID_EVIDENCE";
  return null;
}

export function recoveryPublicShape(row = {}) {
  return {
    id: row.id,
    condominio_id: row.condominio_id,
    historical_account_id: row.historical_account_id,
    unidad_id: row.unidad_id,
    amount: row.amount,
    deposit_total: row.deposit_total,
    payment_reference: row.payment_reference,
    proof_received_at: row.proof_received_at,
    collected_at: row.collected_at,
    custodian_organization: row.custodian_organization,
    bank_confirmation_reference: row.bank_confirmation_reference,
    current_fee_id: row.current_fee_id,
    status: row.status,
    applied_at: row.applied_at,
    reversed_at: row.reversed_at,
    reversal_reason: row.reversal_reason,
    evidence_available: Boolean(row.evidence_path),
  };
}

export function historicalRecoveryErrorCode(error = {}) {
  const message = String(error.message || "").toLowerCase();
  if (error.code === "42501") return "OPERATION_NOT_ALLOWED";
  if (error.code === "23505") return "DUPLICATE_RECOVERY";
  if (message.includes("excede el saldo")) return "HISTORICAL_BALANCE_EXCEEDED";
  if (message.includes("cuota corriente no puede")) return "CURRENT_FEE_NOT_APPLICABLE";
  if (message.includes("ya no está pendiente")) return "RECOVERY_NOT_PENDING";
  if (message.includes("sólo puede revertirse")) return "RECOVERY_NOT_APPLIED";
  if (message.includes("confirmación de pagos reales está bloqueada")) return "REAL_PAYMENTS_BLOCKED";
  if (error.code === "23514" || error.code === "22023") return "VALIDATION_FAILED";
  return "RECOVERY_OPERATION_FAILED";
}
