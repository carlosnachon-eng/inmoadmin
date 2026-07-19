import crypto from "crypto";
import { HttpError } from "./condominiosAuth.js";
import { asText, asUuid, validateDocumentMetadata } from "./condominiosValidation.js";

export const PRIVATE_BUCKET = "condominios-private";

const extensionByMime = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "text/csv": "csv",
  "application/zip": "zip",
};

export function buildObjectPath(condominioId, categoria, mimeType) {
  asUuid(condominioId, "condominio_id");
  const safeCategory = asText(categoria, "categoría", { required: true, min: 3, max: 40 });
  if (!/^[a-z_]+$/.test(safeCategory)) throw new HttpError(400, "Categoría inválida");
  const extension = extensionByMime[mimeType];
  if (!extension) throw new HttpError(400, "Tipo de archivo no permitido");
  return `${condominioId}/${safeCategory}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
}

export async function createSignedUpload({ supabase, condominioId, unidadId, categoria, name, mimeType, sizeBytes, userId }) {
  const metadata = validateDocumentMetadata({ mimeType, sizeBytes, name });
  const objectPath = buildObjectPath(condominioId, categoria, mimeType);
  const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUploadUrl(objectPath);
  if (error) throw new HttpError(500, "No fue posible preparar la carga");
  return {
    ...data,
    objectPath,
    metadata: { ...metadata, condominioId, unidadId: unidadId || null, categoria, userId },
  };
}

export async function finalizeDocument({ supabase, condominioId, unidadId, categoria, objectPath, name, mimeType, sizeBytes, sha256, userId }) {
  validateDocumentMetadata({ mimeType, sizeBytes, name });
  const expectedPrefix = `${condominioId}/${categoria}/`;
  if (!objectPath.startsWith(expectedPrefix) || objectPath.includes("..")) throw new HttpError(400, "Ruta de archivo inválida");

  const directory = objectPath.split("/").slice(0, -1).join("/");
  const filename = objectPath.split("/").pop();
  const { data: objects, error: listError } = await supabase.storage.from(PRIVATE_BUCKET).list(directory, { search: filename, limit: 2 });
  if (listError || !objects?.some((object) => object.name === filename)) {
    throw new HttpError(400, "La carga no fue encontrada");
  }

  const { data, error } = await supabase.from("condominio_documentos").insert({
    condominio_id: condominioId,
    unidad_id: unidadId || null,
    categoria,
    bucket: PRIVATE_BUCKET,
    object_path: objectPath,
    nombre_original: name,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    sha256: sha256 || null,
    created_by: userId,
  }).select("*").single();
  if (error) throw new HttpError(500, "No fue posible registrar el documento");
  return data;
}

export async function signedDocumentUrl(supabase, document, expiresIn = 600) {
  const ttl = Math.min(Math.max(Number(expiresIn) || 600, 60), 600);
  const { data, error } = await supabase.storage.from(document.bucket).createSignedUrl(document.object_path, ttl);
  if (error) throw new HttpError(500, "No fue posible abrir el documento");
  return { url: data.signedUrl, expiresIn: ttl };
}
