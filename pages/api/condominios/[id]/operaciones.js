import {
  enforceRateLimit,
  HttpError,
  requestId,
  requireCondominioPermission,
  sendApiError,
} from "../../../../lib/server/condominiosAuth";
import {
  assertJsonBody,
  asDate,
  asIdempotencyKey,
  asMoney,
  asPeriod,
  asText,
  asUuid,
} from "../../../../lib/server/condominiosValidation";
import {
  completeIdempotency,
  releaseIdempotency,
  reserveIdempotency,
} from "../../../../lib/server/condominiosIdempotency";

export const config = { api: { bodyParser: { sizeLimit: "64kb" } } };

const ACTIONS = {
  generar_cuotas: {
    permission: "generar_cuotas",
    rpc: "condominio_generar_cuotas",
    params(body, context) {
      return {
        p_actor: context.user.id,
        p_condominio: context.condominioId,
        p_periodo: asPeriod(body.periodo),
        p_vencimiento: asDate(body.fecha_vencimiento, "fecha de vencimiento"),
        p_monto: asMoney(body.monto),
        p_request_id: context.requestId,
      };
    },
  },
  registrar_pago: {
    permission: "registrar_pago",
    rpc: "condominio_registrar_pago",
    params(body, context) {
      return {
        p_actor: context.user.id,
        p_condominio: context.condominioId,
        p_unidad: asUuid(body.unidad_id, "unidad_id"),
        p_cuota: asUuid(body.cuota_id, "cuota_id"),
        p_periodo: asPeriod(body.periodo),
        p_monto: asMoney(body.monto),
        p_fecha: asDate(body.fecha_pago, "fecha de pago"),
        p_metodo: asText(body.metodo, "método", { max: 60 }),
        p_referencia: asText(body.referencia, "referencia", { max: 160 }),
        p_notas: asText(body.notas, "notas", { max: 1000 }),
        p_documento: body.documento_id ? asUuid(body.documento_id, "documento_id") : null,
        p_request_id: context.requestId,
      };
    },
  },
  registrar_gasto: {
    permission: "registrar_gasto",
    rpc: "condominio_registrar_gasto",
    params(body, context) {
      return {
        p_actor: context.user.id,
        p_condominio: context.condominioId,
        p_periodo: asPeriod(body.periodo),
        p_concepto: asText(body.concepto, "concepto", { required: true, min: 3, max: 200 }),
        p_categoria: asText(body.categoria, "categoría", { required: true, min: 2, max: 80 }),
        p_monto: asMoney(body.monto),
        p_fecha: asDate(body.fecha, "fecha"),
        p_notas: asText(body.notas, "notas", { max: 1000 }),
        p_request_id: context.requestId,
      };
    },
  },
  reversar: {
    permission: (body) => body.tipo === "pago" ? "reversar_pago" : "reversar_gasto",
    rpc: "condominio_reversar",
    params(body, context) {
      if (!["pago", "gasto"].includes(body.tipo)) throw new HttpError(400, "Tipo de reversa inválido");
      return {
        p_actor: context.user.id,
        p_condominio: context.condominioId,
        p_tipo: body.tipo,
        p_id: asUuid(body.id, "id"),
        p_motivo: asText(body.motivo, "motivo", { required: true, min: 8, max: 500 }),
        p_request_id: context.requestId,
      };
    },
  },
  saldo_inicial: {
    permission: "registrar_pago",
    rpc: "condominio_registrar_saldo_inicial",
    params(body, context) {
      return {
        p_actor: context.user.id,
        p_condominio: context.condominioId,
        p_unidad: asUuid(body.unidad_id, "unidad_id"),
        p_fecha: asDate(body.fecha_corte, "fecha de corte"),
        p_monto: asMoney(body.monto, "monto", { allowNegative: true }),
        p_motivo: asText(body.motivo, "motivo", { required: true, min: 8, max: 500 }),
        p_request_id: context.requestId,
      };
    },
  },
  cambiar_periodo: {
    permission: (body) => body.estado === "abierto" ? "reabrir_periodo" : "cerrar_periodo",
    rpc: "condominio_cambiar_periodo",
    params(body, context) {
      if (!["abierto", "cerrado"].includes(body.estado)) throw new HttpError(400, "Estado inválido");
      return {
        p_actor: context.user.id,
        p_condominio: context.condominioId,
        p_periodo: asPeriod(body.periodo),
        p_estado: body.estado,
        p_motivo: asText(body.motivo, "motivo", {
          required: body.estado === "abierto",
          min: body.estado === "abierto" ? 8 : 0,
          max: 500,
        }),
        p_request_id: context.requestId,
      };
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  let idempotency;
  let context;
  let condominioId;
  try {
    const body = assertJsonBody(req, 64 * 1024);
    condominioId = asUuid(req.query.id, "condominio_id");
    const definition = ACTIONS[body.action];
    if (!definition) throw new HttpError(400, "Operación no soportada");
    const permission = typeof definition.permission === "function" ? definition.permission(body) : definition.permission;
    context = await requireCondominioPermission(req, condominioId, permission);
    await enforceRateLimit(context.supabase, `ops:${context.user.id}:${condominioId}`, 60, 60);
    const key = asIdempotencyKey(req);
    idempotency = await reserveIdempotency({
      supabase: context.supabase,
      actorId: context.user.id,
      condominioId,
      key,
      payload: body,
    });
    if (idempotency.cached) return res.status(200).json({ ok: true, cached: true, data: idempotency.response });

    const operationContext = {
      ...context,
      condominioId,
      requestId: requestId(req),
    };
    const params = definition.params(body, operationContext);
    const { data, error } = await context.supabase.rpc(definition.rpc, params);
    if (error) {
      if (["42501", "23514", "23505", "22023", "P0002"].includes(error.code)) {
        throw new HttpError(error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409, error.message);
      }
      throw new Error(error.message);
    }
    if (body.action === "registrar_gasto" && body.documento_id && data?.id) {
      const documentId = asUuid(body.documento_id, "documento_id");
      const { data: document } = await context.supabase
        .from("condominio_documentos")
        .select("id")
        .eq("id", documentId)
        .eq("condominio_id", condominioId)
        .eq("categoria", "gasto")
        .maybeSingle();
      if (!document) throw new HttpError(400, "Documento de gasto inválido");
      const { error: linkError } = await context.supabase
        .from("gastos_condominio")
        .update({ documento_id: documentId })
        .eq("id", data.id)
        .eq("condominio_id", condominioId);
      if (linkError) throw new Error(linkError.message);
      data.documento_id = documentId;
    }
    await completeIdempotency({
      supabase: context.supabase,
      actorId: context.user.id,
      condominioId,
      key,
      response: data,
    });
    return res.status(200).json({ ok: true, cached: false, data });
  } catch (error) {
    if (context && condominioId && req.headers["idempotency-key"] && !idempotency?.cached) {
      await releaseIdempotency({
        supabase: context.supabase,
        actorId: context.user.id,
        condominioId,
        key: String(req.headers["idempotency-key"]),
      });
    }
    return sendApiError(res, error);
  }
}
