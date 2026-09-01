export const RESERVE_FUND_STATUSES = Object.freeze({
  pending: "pending",
  reconciled: "reconciled",
  reversed: "reversed",
});

export const RESERVE_FUND_EVIDENCE_BUCKET = "condominium-reserve-fund-evidence";
export const MAX_RESERVE_FUND_EVIDENCE_BYTES = 5 * 1024 * 1024;

const MIME_EXTENSION = Object.freeze({
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isReserveFundUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

export function reserveFundEvidenceExtension(mimeType) {
  return MIME_EXTENSION[String(mimeType || "").toLowerCase()] || null;
}

export function reserveFundEvidencePath({ condominioId, receiptId, mimeType }) {
  const extension = reserveFundEvidenceExtension(mimeType);
  if (![condominioId, receiptId].every(isReserveFundUuid) || !extension) return null;
  return `${condominioId}/${receiptId}.${extension}`;
}

export function decodeReserveFundEvidenceBase64(value) {
  const raw = String(value || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.length || bytes.length > MAX_RESERVE_FUND_EVIDENCE_BYTES) return null;
  return bytes;
}

export function reserveFundEvidenceMatchesMime(bytes, mimeType) {
  if (!Buffer.isBuffer(bytes)) return false;
  if (mimeType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") {
    return bytes.length >= 8
      && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return false;
}

export function validateReserveFundCreateInput(payload = {}) {
  if (![payload.condominioId, payload.idempotencyKey].every(isReserveFundUuid)) return "INVALID_SCOPE";
  if (!Array.isArray(payload.allocations) || payload.allocations.length < 1 || payload.allocations.length > 100) return "INVALID_ALLOCATIONS";
  const unitIds = payload.allocations.map(allocation => allocation?.unidadId);
  if (!unitIds.every(isReserveFundUuid) || new Set(unitIds).size !== unitIds.length) return "INVALID_ALLOCATIONS";
  if (!payload.allocations.every(allocation => Number.isFinite(Number(allocation?.amount)) && Number(allocation.amount) > 0)) return "INVALID_AMOUNT";
  if (String(payload.sourceOrganization || "").trim().length < 2) return "INVALID_SOURCE";
  if (String(payload.paymentReference || "").trim().length < 3) return "INVALID_REFERENCE";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.proofDate || ""))
      || Number.isNaN(Date.parse(`${payload.proofDate}T00:00:00Z`))) return "INVALID_PROOF_DATE";
  if (!payload.evidence || !reserveFundEvidenceExtension(payload.evidence.mimeType)) return "INVALID_EVIDENCE_TYPE";
  const evidenceBytes = decodeReserveFundEvidenceBase64(payload.evidence.base64);
  if (!evidenceBytes || !reserveFundEvidenceMatchesMime(evidenceBytes, payload.evidence.mimeType)) return "INVALID_EVIDENCE";
  return null;
}

export function reserveFundReceiptPublicShape(row = {}) {
  return {
    id: row.id,
    condominio_id: row.condominio_id,
    total_amount: row.total_amount,
    contributions: Array.isArray(row.contributions)
      ? row.contributions.map(contribution => ({
        id: contribution.id,
        unidad_id: contribution.unidad_id,
        amount: contribution.amount,
      }))
      : [],
    source_organization: row.source_organization,
    proof_date: row.proof_date,
    deposit_date: row.deposit_date,
    payment_reference: row.payment_reference,
    status: row.status,
    bank_confirmed_by: row.bank_confirmed_by,
    reconciled_at: row.reconciled_at,
    reversed_at: row.reversed_at,
    reversal_reason: row.reversal_reason,
    evidence_available: Boolean(row.evidence_path),
    created_at: row.created_at,
  };
}

export function reserveFundErrorCode(error = {}) {
  const message = String(error.message || "").toLowerCase();
  if (error.code === "42501") return "OPERATION_NOT_ALLOWED";
  if (error.code === "23505") return "DUPLICATE_CONTRIBUTION";
  if (message.includes("ya no está pendiente")) return "CONTRIBUTION_NOT_PENDING";
  if (message.includes("sólo puede revertirse")) return "CONTRIBUTION_NOT_RECONCILED";
  if (message.includes("pagos reales está bloqueada")) return "REAL_PAYMENTS_BLOCKED";
  if (error.code === "23514" || error.code === "22023") return "VALIDATION_FAILED";
  return "RESERVE_FUND_OPERATION_FAILED";
}
