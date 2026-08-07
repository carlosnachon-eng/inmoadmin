import {
  enforceRateLimit,
  HttpError,
  requestId,
  requireUser,
  sendApiError,
} from "../../../lib/server/condominiosAuth";
import {
  assertJsonBody,
  asIdempotencyKey,
  asMoney,
  asText,
} from "../../../lib/server/condominiosValidation";
import {
  completeIdempotency,
  releaseIdempotency,
  reserveIdempotency,
} from "../../../lib/server/condominiosIdempotency";

export const config = { api: { bodyParser: { sizeLimit: "32kb" } } };

const CREATION_SCOPE = "00000000-0000-4000-8000-000000000000";

export default async function handler(req, res) {
  let context;
  let reservation;
  let key;
  try {
    context = await requireUser(req);
    if (req.method === "GET") {
      const { data: memberships, error: membershipError } = await context.supabase
        .from("condominio_miembros")
        .select("condominio_id,rol")
        .eq("user_id", context.user.id)
        .eq("activo", true);
      if (membershipError) throw new Error(membershipError.message);
      const globalAccess = memberships?.some((member) =>
        member.condominio_id === null && ["direccion", "administrador_general"].includes(member.rol)
      );
      const condoIds = [...new Set((memberships || []).map((member) => member.condominio_id).filter(Boolean))];
      if (!globalAccess && !condoIds.length) return res.status(200).json({ ok: true, data: [] });
      let query = context.supabase
        .from("condominios")
        .select("*, unidades_condominio(id), cuotas_condominio(id,monto,status,periodo), gastos_condominio(id,monto,fecha,reversed_at)")
        .order("created_at", { ascending: false });
      if (!globalAccess) query = query.in("id", condoIds);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true, data: data || [] });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
    await enforceRateLimit(context.supabase, `condo-create:${context.user.id}`, 5, 3600);
    const body = assertJsonBody(req, 32 * 1024);
    const { data: allowed, error: permissionError } = await context.supabase.rpc("condominio_usuario_puede", {
      p_user_id: context.user.id,
      p_condominio_id: CREATION_SCOPE,
      p_accion: "crear",
      p_unidad_id: null,
    });
    if (permissionError) throw new Error(permissionError.message);
    if (!allowed) throw new HttpError(403, "Acceso denegado");

    key = asIdempotencyKey(req);
    reservation = await reserveIdempotency({
      supabase: context.supabase,
      actorId: context.user.id,
      condominioId: CREATION_SCOPE,
      key,
      payload: body,
    });
    if (reservation.cached) return res.status(200).json({ ok: true, cached: true, data: reservation.response });
    const params = {
      p_actor: context.user.id,
      p_nombre: asText(body.nombre, "nombre", { required: true, min: 3, max: 180 }),
      p_direccion: asText(body.direccion, "dirección", { max: 300 }),
      p_total_unidades: Number.parseInt(body.total_unidades, 10),
      p_cuota_mensual: asMoney(body.cuota_mensual, "cuota mensual", { allowZero: true }),
      p_honorarios: asMoney(body.honorarios_emporio, "honorarios", { allowZero: true }),
      p_notas: asText(body.notas, "notas", { max: 1000 }),
      p_request_id: requestId(req),
    };
    if (!Number.isInteger(params.p_total_unidades) || params.p_total_unidades < 1 || params.p_total_unidades > 5000) {
      throw new HttpError(400, "Total de unidades inválido");
    }
    const { data: created, error } = await context.supabase.rpc("condominio_crear", params);
    if (error) throw new Error(error.message);
    await completeIdempotency({
      supabase: context.supabase,
      actorId: context.user.id,
      condominioId: CREATION_SCOPE,
      key,
      response: created,
    });
    return res.status(201).json({ ok: true, cached: false, data: created });
  } catch (error) {
    if (context && key && !reservation?.cached) {
      await releaseIdempotency({
        supabase: context.supabase,
        actorId: context.user.id,
        condominioId: CREATION_SCOPE,
        key,
      });
    }
    return sendApiError(res, error);
  }
}
