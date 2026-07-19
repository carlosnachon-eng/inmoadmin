import crypto from "crypto";
import { HttpError } from "./condominiosAuth.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERIOD = /^(20\d{2})-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{16,128}$/;

export function asUuid(value, field = "id") {
  if (!UUID.test(String(value || ""))) throw new HttpError(400, `${field} inválido`);
  return String(value);
}

export function asPeriod(value) {
  if (!PERIOD.test(String(value || ""))) throw new HttpError(400, "Periodo inválido");
  return String(value);
}

export function asDate(value, field = "fecha") {
  const text = String(value || "");
  if (!DATE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new HttpError(400, `${field} inválida`);
  }
  return text;
}

export function asMoney(value, field = "monto", { allowZero = false, allowNegative = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 999999999999) {
    throw new HttpError(400, `${field} inválido`);
  }
  if (!allowNegative && number < 0) throw new HttpError(400, `${field} inválido`);
  if (!allowZero && number === 0) throw new HttpError(400, `${field} inválido`);
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

export function asText(value, field, { min = 0, max = 500, required = false } = {}) {
  const text = String(value ?? "").trim();
  if ((required && !text) || text.length < min || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new HttpError(400, `${field} inválido`);
  }
  return text || null;
}

export function asIdempotencyKey(req) {
  const key = String(req.headers["idempotency-key"] || "");
  if (!IDEMPOTENCY.test(key)) {
    throw new HttpError(400, "Idempotency-Key requerido (16 a 128 caracteres)");
  }
  return key;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function stableHash(value) {
  const sort = (input) => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object") {
      return Object.keys(input).sort().reduce((result, key) => {
        result[key] = sort(input[key]);
        return result;
      }, {});
    }
    return input;
  };
  return sha256(JSON.stringify(sort(value)));
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}

export const ALLOWED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "application/zip",
]);

export function validateDocumentMetadata({ mimeType, sizeBytes, name }) {
  if (!ALLOWED_DOCUMENT_TYPES.has(mimeType)) throw new HttpError(400, "Tipo de archivo no permitido");
  const size = Number(sizeBytes);
  if (!Number.isInteger(size) || size < 1 || size > 10 * 1024 * 1024) {
    throw new HttpError(400, "El archivo debe pesar como máximo 10 MB");
  }
  const safeName = asText(name, "nombre", { required: true, min: 1, max: 180 });
  if (safeName.includes("/") || safeName.includes("\\")) throw new HttpError(400, "Nombre de archivo inválido");
  return { mimeType, sizeBytes: size, name: safeName };
}

export function assertJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  const size = Number(req.headers["content-length"] || 0);
  if (size > maxBytes) throw new HttpError(413, "Solicitud demasiado grande");
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new HttpError(400, "Cuerpo JSON inválido");
  }
  return req.body;
}
