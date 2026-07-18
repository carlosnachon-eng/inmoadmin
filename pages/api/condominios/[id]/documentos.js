import {
  enforceRateLimit,
  HttpError,
  requestId,
  requireCondominioPermission,
  requireUser,
  sendApiError,
} from "../../../../lib/server/condominiosAuth";
import { assertJsonBody, asText, asUuid } from "../../../../lib/server/condominiosValidation";
import {
  createSignedUpload,
  finalizeDocument,
  signedDocumentUrl,
} from "../../../../lib/server/condominiosStorage";

export const config = { api: { bodyParser: { sizeLimit: "64kb" } } };

const CATEGORIES = new Set(["comprobante_pago", "recibo", "gasto", "juridico", "operativo", "importacion"]);

export default async function handler(req, res) {
  try {
    const condominioId = asUuid(req.query.id, "condominio_id");
    if (req.method === "GET") {
      const documentId = asUuid(req.query.documento_id, "documento_id");
      const context = await requireUser(req);
      await enforceRateLimit(context.supabase, `document:${context.user.id}`, 60, 60);
      const { data: document, error } = await context.supabase
        .from("condominio_documentos")
        .select("*")
        .eq("id", documentId)
        .eq("condominio_id", condominioId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!document) throw new HttpError(404, "Documento no encontrado");
      await requireCondominioPermission(req, condominioId, "consultar", document.unidad_id);
      const signed = await signedDocumentUrl(context.supabase, document);
      await context.supabase.rpc("condominio_auditar", {
        p_actor: context.user.id,
        p_condominio: condominioId,
        p_unidad: document.unidad_id,
        p_accion: "descargar_documento",
        p_entidad: "condominio_documentos",
        p_entidad_id: document.id,
        p_motivo: null,
        p_antes: null,
        p_despues: null,
        p_request_id: requestId(req),
      });
      return res.status(200).json({ ok: true, data: signed });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
    const body = assertJsonBody(req, 64 * 1024);
    const unidadId = body.unidad_id ? asUuid(body.unidad_id, "unidad_id") : null;
    const cuotaId = body.cuota_id ? asUuid(body.cuota_id, "cuota_id") : null;
    const context = await requireCondominioPermission(req, condominioId, "subir_documento", unidadId);
    await enforceRateLimit(context.supabase, `upload:${context.user.id}:${condominioId}`, 20, 300);
    const category = asText(body.categoria, "categoría", { required: true, min: 3, max: 40 });
    if (!CATEGORIES.has(category)) throw new HttpError(400, "Categoría inválida");

    if (body.action === "create_upload") {
      const data = await createSignedUpload({
        supabase: context.supabase,
        condominioId,
        unidadId,
        categoria: category,
        name: body.name,
        mimeType: body.mime_type,
        sizeBytes: body.size_bytes,
        userId: context.user.id,
      });
      return res.status(200).json({ ok: true, data });
    }
    if (body.action !== "finalize") throw new HttpError(400, "Acción inválida");
    const document = await finalizeDocument({
      supabase: context.supabase,
      condominioId,
      unidadId,
      categoria: category,
      objectPath: asText(body.object_path, "ruta", { required: true, min: 20, max: 500 }),
      name: body.name,
      mimeType: body.mime_type,
      sizeBytes: body.size_bytes,
      sha256: body.sha256 || null,
      userId: context.user.id,
    });
    if (category === "comprobante_pago") {
      if (!cuotaId || !unidadId) throw new HttpError(400, "Cuota y unidad requeridas para el comprobante");
      const { data: fee, error: feeError } = await context.supabase
        .from("cuotas_condominio")
        .update({ comprobante_documento_id: document.id, status: "pendiente" })
        .eq("id", cuotaId)
        .eq("condominio_id", condominioId)
        .eq("unidad_id", unidadId)
        .select("id")
        .maybeSingle();
      if (feeError || !fee) throw new HttpError(404, "Cuota no encontrada");
    }
    await context.supabase.rpc("condominio_auditar", {
      p_actor: context.user.id,
      p_condominio: condominioId,
      p_unidad: unidadId,
      p_accion: "subir_documento",
      p_entidad: "condominio_documentos",
      p_entidad_id: document.id,
      p_motivo: null,
      p_antes: null,
      p_despues: { categoria: category, mime_type: document.mime_type, size_bytes: document.size_bytes },
      p_request_id: requestId(req),
    });
    return res.status(201).json({ ok: true, data: document });
  } catch (error) {
    return sendApiError(res, error);
  }
}
