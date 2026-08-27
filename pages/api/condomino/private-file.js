import { randomUUID } from "node:crypto";
import {
  OWNER_BUCKET,
  authorizePortalRequest,
  createPortalAdmin,
  publicPortalError,
  safeExtension,
} from "../../../lib/condominios/ownerPortalServer.mjs";

export const config = { api: { bodyParser: { sizeLimit: "32kb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return publicPortalError(res, 405, "Método no permitido");

  const authorization = await authorizePortalRequest(req);
  if (authorization.error) return publicPortalError(res, authorization.status, authorization.error);

  const { action, kind, recordId } = req.body || {};
  if (!action || !kind || !recordId) return publicPortalError(res, 400, "Solicitud incompleta");

  // El cliente privilegiado sólo se construye después de validar la sesión.
  const admin = createPortalAdmin();
  if (!admin) return publicPortalError(res, 503, "Servicio temporalmente no disponible");

  try {
    if (action === "prepare-upload") {
      if (kind !== "fee-proof") return publicPortalError(res, 400, "Carga no permitida");
      const extension = safeExtension(req.body.extension);
      if (!extension) return publicPortalError(res, 400, "Tipo de archivo no permitido");

      const { data: fee, error: feeError } = await authorization.scoped
        .from("cuotas_condominio")
        .select("id,condominio_id,unidad_id,status")
        .eq("id", recordId)
        .maybeSingle();
      if (feeError || !fee || fee.status === "pagado") {
        return publicPortalError(res, 403, "Cuota no disponible para comprobante");
      }

      const path = `${fee.condominio_id}/${fee.unidad_id}/fee-proof/${fee.id}/${randomUUID()}.${extension}`;
      const { data, error } = await admin.storage.from(OWNER_BUCKET).createSignedUploadUrl(path);
      if (error || !data?.token) return publicPortalError(res, 503, "No fue posible preparar la carga");
      return res.status(200).json({ path, token: data.token });
    }

    if (action === "confirm-upload") {
      if (kind !== "fee-proof" || !req.body.path) return publicPortalError(res, 400, "Confirmación incompleta");
      const { error } = await authorization.scoped.rpc("condominium_owner_attach_fee_proof", {
        p_fee_id: recordId,
        p_storage_path: req.body.path,
      });
      if (error) return publicPortalError(res, 403, "No fue posible asociar el comprobante");
      return res.status(200).json({ ok: true });
    }

    if (action === "download") {
      if (!["fee-proof", "fee-receipt", "document"].includes(kind)) {
        return publicPortalError(res, 400, "Tipo de archivo no permitido");
      }
      const { data: path, error: pathError } = await authorization.scoped.rpc(
        "condominium_owner_storage_path",
        { p_kind: kind, p_record_id: recordId },
      );
      if (pathError || !path) return publicPortalError(res, 403, "Archivo no autorizado");
      const { data, error } = await admin.storage.from(OWNER_BUCKET).createSignedUrl(path, 60);
      if (error || !data?.signedUrl) return publicPortalError(res, 503, "No fue posible abrir el archivo");
      return res.status(200).json({ url: data.signedUrl, expiresIn: 60 });
    }

    return publicPortalError(res, 400, "Acción no permitida");
  } catch (error) {
    console.error("condominium_owner_private_file_failed", { name: error?.name || "Error", action, kind });
    return publicPortalError(res, 500, "No fue posible completar la operación");
  }
}
