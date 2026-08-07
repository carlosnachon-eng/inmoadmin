import {
  enforceRateLimit,
  HttpError,
  requestId,
  requireCondominioPermission,
  sendApiError,
} from "../../../../lib/server/condominiosAuth";
import { assertJsonBody, asIdempotencyKey, asUuid, sha256 } from "../../../../lib/server/condominiosValidation";
import { validateUnitCsv } from "../../../../lib/server/csv";
import { toCsv, UNIT_COLUMNS } from "../../../../lib/server/csv";
import {
  completeIdempotency,
  releaseIdempotency,
  reserveIdempotency,
} from "../../../../lib/server/condominiosIdempotency";

export const config = { api: { bodyParser: { sizeLimit: "2mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  let context;
  let reservation;
  let key;
  try {
    const condominioId = asUuid(req.query.id, "condominio_id");
    context = await requireCondominioPermission(req, condominioId, "importar_unidades");
    await enforceRateLimit(context.supabase, `import:${context.user.id}:${condominioId}`, 10, 300);
    const body = assertJsonBody(req, 2 * 1024 * 1024);

    if (body.action === "preview") {
      if (typeof body.csv !== "string" || Buffer.byteLength(body.csv, "utf8") > 2 * 1024 * 1024) {
        throw new HttpError(413, "El CSV debe pesar como máximo 2 MB");
      }
      const result = validateUnitCsv(body.csv);
      const hash = sha256(body.csv);
      const { data: currentUnits, error: currentError } = await context.supabase
        .from("unidades_condominio")
        .select("numero,piso,propietario_nombre,propietario_email,propietario_telefono,residente_nombre,residente_email,residente_telefono,residente_es_propietario,notas")
        .eq("condominio_id", condominioId)
        .eq("activo", true);
      if (currentError) throw new Error(currentError.message);
      const currentByNumber = new Map((currentUnits || []).map((unit) => [String(unit.numero).toLocaleLowerCase("es-MX"), unit]));
      const incomingNumbers = new Set(result.rows.map((unit) => unit.numero.toLocaleLowerCase("es-MX")));
      const altas = result.rows.filter((unit) => !currentByNumber.has(unit.numero.toLocaleLowerCase("es-MX"))).length;
      const cambios = result.rows.filter((unit) => {
        const current = currentByNumber.get(unit.numero.toLocaleLowerCase("es-MX"));
        return current && UNIT_COLUMNS.some((column) => String(current[column] ?? "") !== String(unit[column] ?? ""));
      }).length;
      const resumen = {
        altas,
        cambios,
        sin_cambios: result.rows.length - altas - cambios,
        omisiones: (currentUnits || []).filter((unit) => !incomingNumbers.has(String(unit.numero).toLocaleLowerCase("es-MX"))).length,
      };
      const { data, error } = await context.supabase.from("condominio_import_batches").insert({
        condominio_id: condominioId,
        filas: result.rows,
        errores: result.errors,
        hash,
        created_by: context.user.id,
      }).select("id,estado,filas,errores,hash,expires_at").single();
      if (error) throw new Error(error.message);
      await context.supabase.rpc("condominio_auditar", {
        p_actor: context.user.id,
        p_condominio: condominioId,
        p_unidad: null,
        p_accion: "importacion_preview",
        p_entidad: "condominio_import_batches",
        p_entidad_id: data.id,
        p_motivo: null,
        p_antes: null,
        p_despues: { filas: result.rows.length, errores: result.errors.length, hash },
        p_request_id: requestId(req),
      });
      return res.status(200).json({ ok: true, data: { ...data, resumen } });
    }

    if (body.action !== "commit") throw new HttpError(400, "Acción de importación inválida");
    const batchId = asUuid(body.batch_id, "batch_id");
    const { data: batch, error: batchError } = await context.supabase
      .from("condominio_import_batches")
      .select("filas")
      .eq("id", batchId)
      .eq("condominio_id", condominioId)
      .maybeSingle();
    if (batchError) throw new Error(batchError.message);
    if (!batch) throw new HttpError(404, "Vista previa no encontrada");
    key = asIdempotencyKey(req);
    reservation = await reserveIdempotency({
      supabase: context.supabase,
      actorId: context.user.id,
      condominioId,
      key,
      payload: { action: "commit", batch_id: batchId },
    });
    if (reservation.cached) return res.status(200).json({ ok: true, cached: true, data: reservation.response });

    const { data, error } = await context.supabase.rpc("condominio_aplicar_importacion", {
      p_actor: context.user.id,
      p_batch: batchId,
      p_request_id: requestId(req),
    });
    if (error) {
      if (["42501", "22023"].includes(error.code)) throw new HttpError(error.code === "42501" ? 403 : 409, error.message);
      throw new Error(error.message);
    }
    const resultCsv = toCsv(
      (batch.filas || []).map((row) => ({ ...row, resultado: "aplicada" })),
      [...UNIT_COLUMNS, "resultado"],
    );
    const response = { ...data, resultado_csv: resultCsv };
    await completeIdempotency({
      supabase: context.supabase,
      actorId: context.user.id,
      condominioId,
      key,
      response,
    });
    return res.status(200).json({ ok: true, cached: false, data: response });
  } catch (error) {
    if (context && key && !reservation?.cached) {
      await releaseIdempotency({
        supabase: context.supabase,
        actorId: context.user.id,
        condominioId: req.query.id,
        key,
      });
    }
    return sendApiError(res, error);
  }
}
