import { createHash } from "node:crypto";

export const FINANCIAL_EVIDENCE_BUCKET = "condominium-financial-evidence";
export const MAX_FINANCIAL_EVIDENCE_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = Object.freeze({ "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" });

export const isFinancialUuid = value => UUID.test(String(value || ""));

export function financialEvidence(value = {}) {
  const mimeType = String(value.mimeType || "").toLowerCase();
  const raw = String(value.base64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!MIME[mimeType] || !raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.length || bytes.length > MAX_FINANCIAL_EVIDENCE_BYTES) return null;
  const valid = mimeType === "application/pdf" ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
    : mimeType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (!valid) return null;
  return { bytes, mimeType, extension: MIME[mimeType], sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function financialEvidencePath({ condominioId, receiptId, extension }) {
  if (![condominioId, receiptId].every(isFinancialUuid) || !Object.values(MIME).includes(extension)) return null;
  return `${condominioId}/receipts/${receiptId}.${extension}`;
}

export function validateFinancialAction(action, body = {}) {
  if (!isFinancialUuid(body.condominioId)) return "INVALID_CONDOMINIUM";
  const required = {
    "create-charge": ["id","unidadId","conceptId","periodId","idempotencyKey"],
    "import-bank-transaction": ["id","bankAccountId","idempotencyKey"],
    "identify-bank-transaction": ["transactionId","unidadId"],
    "create-receipt": ["id","idempotencyKey"],
    "apply-receipt": ["receiptId"],
    "match-bank-receipt": ["transactionId","receiptId","idempotencyKey"],
    "confirm-receipt": ["receiptId","periodId","idempotencyKey"],
    "reverse-receipt": ["receiptId","periodId","idempotencyKey"],
  }[action];
  if (!required || !required.every(key => isFinancialUuid(body[key]))) return "INVALID_ACTION_INPUT";
  return null;
}

export function financialErrorCode(error = {}) {
  const message = String(error.message || "");
  if (error.code === "42501") return "OPERATION_NOT_ALLOWED";
  if (error.code === "23505" || message.includes("IDEMPOTENCY")) return "IDEMPOTENCY_CONFLICT";
  if (message.includes("LEDGER_INACTIVE")) return "LEDGER_INACTIVE";
  if (message.includes("PERIOD_NOT_OPEN")) return "PERIOD_CLOSED";
  if (message.includes("EXCEEDS")) return "AMOUNT_EXCEEDS_AVAILABLE";
  if (message.includes("OUT_OF_SCOPE") || message.includes("SCOPE_INVALID")) return "SCOPE_MISMATCH";
  if (error.code === "23514" || error.code === "22023") return "VALIDATION_FAILED";
  return "FINANCIAL_OPERATION_FAILED";
}
