const ALLOWED_UPLOAD_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function validateCondominioUploadFile(file) {
  if (!file) return null;
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
    throw new Error("El comprobante debe ser PDF, JPG, PNG o WebP");
  }
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
    throw new Error("El comprobante debe pesar como máximo 10 MB");
  }
  return file;
}
