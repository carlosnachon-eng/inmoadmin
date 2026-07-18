import { supabase } from "./supabase";

function idempotencyKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export async function condominiosApi(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(options.method && options.method !== "GET" ? { "Idempotency-Key": options.idempotencyKey || idempotencyKey() } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No fue posible completar la operación");
  return payload.data;
}

export async function uploadCondominioDocument({ condominioId, unidadId, cuotaId, categoria, file }) {
  const preparation = await condominiosApi(`/api/condominios/${condominioId}/documentos`, {
    method: "POST",
    body: JSON.stringify({
      action: "create_upload",
      unidad_id: unidadId || null,
      cuota_id: cuotaId || null,
      categoria,
      name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    }),
  });
  const { error } = await supabase.storage
    .from("condominios-private")
    .uploadToSignedUrl(preparation.path, preparation.token, file, { contentType: file.type });
  if (error) throw error;
  return condominiosApi(`/api/condominios/${condominioId}/documentos`, {
    method: "POST",
    body: JSON.stringify({
      action: "finalize",
      unidad_id: unidadId || null,
      cuota_id: cuotaId || null,
      categoria,
      object_path: preparation.objectPath,
      name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    }),
  });
}
