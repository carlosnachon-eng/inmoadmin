export const RESERVE_FUND_STATUSES = Object.freeze({
  receivedByAntiveUnverified: "received_by_antive_unverified",
  pending: "pending",
  reconciled: "reconciled",
  reversed: "reversed",
  voided: "voided",
});

export const RESERVE_FUND_RECORD_KINDS = Object.freeze({
  bankReceipt: "bank_receipt",
  antiveHistoricalReport: "antive_historical_report",
});

export const RESERVE_FUND_EVIDENCE_BUCKET = "condominium-reserve-fund-evidence";
export const MAX_RESERVE_FUND_EVIDENCE_BYTES = 5 * 1024 * 1024;

const MIME_EXTENSION = Object.freeze({
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

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

export function validateReserveFundAntiveBatchInput(payload = {}) {
  if (![payload.condominioId, payload.batchId].every(isReserveFundUuid)) return "INVALID_SCOPE";
  if (!SHA256_PATTERN.test(String(payload.sourceFileSha256 || ""))) return "INVALID_SOURCE_FILE_HASH";
  const sourceSheet = String(payload.sourceSheet || "").trim();
  if (!sourceSheet || sourceSheet.length > 160) return "INVALID_SOURCE_SHEET";
  const confirmedBy = String(payload.receivedConfirmedBy || "").trim();
  if (confirmedBy.length < 2 || confirmedBy.length > 160) return "INVALID_ANTIVE_CONFIRMATION";
  const confirmedAt = String(payload.receivedConfirmedAt || "");
  if (!confirmedAt || Number.isNaN(Date.parse(confirmedAt))) return "INVALID_ANTIVE_CONFIRMATION_DATE";
  if (String(payload.receivedConfirmationNote || "").trim().length > 1000) return "INVALID_CONFIRMATION_NOTE";
  if (!Array.isArray(payload.records) || payload.records.length < 1 || payload.records.length > 100) return "INVALID_RECORDS";

  const unitIds = new Set();
  const sourceRanges = new Set();
  for (const record of payload.records) {
    if (![record?.receiptId, record?.idempotencyKey, record?.unidadId].every(isReserveFundUuid)) return "INVALID_RECORDS";
    if (!Number.isFinite(Number(record?.amount)) || Number(record.amount) <= 0) return "INVALID_AMOUNT";
    const sourceRange = String(record?.sourceRange || "").trim();
    if (!sourceRange || sourceRange.length > 160) return "INVALID_SOURCE_RANGE";
    if (unitIds.has(record.unidadId) || sourceRanges.has(sourceRange.toUpperCase())) return "DUPLICATE_SOURCE_RECORD";
    unitIds.add(record.unidadId);
    sourceRanges.add(sourceRange.toUpperCase());
  }
  return null;
}

export function validateReserveFundEvidenceEnrichmentInput(payload = {}) {
  if (![payload.condominioId, payload.receiptId].every(isReserveFundUuid)) return "INVALID_SCOPE";
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
    record_kind: row.record_kind,
    proof_date: row.proof_date,
    deposit_date: row.deposit_date,
    payment_reference: row.payment_reference,
    status: row.status,
    bank_confirmed_by: row.bank_confirmed_by,
    reconciled_at: row.reconciled_at,
    reversed_at: row.reversed_at,
    reversal_reason: row.reversal_reason,
    voided_at: row.voided_at,
    void_reason: row.void_reason,
    import_batch_id: row.import_batch_id,
    source_file_sha256: row.source_file_sha256,
    source_sheet: row.source_sheet,
    source_range: row.source_range,
    received_confirmed_by: row.received_confirmed_by,
    received_confirmed_at: row.received_confirmed_at,
    received_confirmation_note: row.received_confirmation_note,
    evidence_enriched_at: row.evidence_enriched_at,
    evidence_available: Boolean(row.evidence_path),
    created_at: row.created_at,
  };
}

export function reserveFundErrorCode(error = {}) {
  const message = String(error.message || "").toLowerCase();
  if (error.code === "42501") return "OPERATION_NOT_ALLOWED";
  if (error.code === "23505") return "DUPLICATE_CONTRIBUTION";
  if (message.includes("ya no está pendiente")) return "CONTRIBUTION_NOT_PENDING";
  if (message.includes("evidencia suficiente")) return "EVIDENCE_REQUIRED_FOR_RECONCILIATION";
  if (message.includes("no admite enriquecimiento")) return "CONTRIBUTION_NOT_ENRICHABLE";
  if (message.includes("no puede anularse")) return "CONTRIBUTION_NOT_VOIDABLE";
  if (message.includes("lote ya fue utilizado")) return "IMPORT_BATCH_CONFLICT";
  if (message.includes("fuente administrativa ya fue utilizada")) return "DUPLICATE_SOURCE_RECORD";
  if (message.includes("sólo puede revertirse")) return "CONTRIBUTION_NOT_RECONCILED";
  if (message.includes("pagos reales está bloqueada")) return "REAL_PAYMENTS_BLOCKED";
  if (error.code === "23514" || error.code === "22023") return "VALIDATION_FAILED";
  return "RESERVE_FUND_OPERATION_FAILED";
}
