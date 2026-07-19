import {
  enforceRateLimit,
  HttpError,
  requestId,
  requireCondominioPermission,
  sendApiError,
} from "../../../../lib/server/condominiosAuth";
import {
  assertJsonBody,
  asText,
  asUuid,
} from "../../../../lib/server/condominiosValidation";

export const config = { api: { bodyParser: { sizeLimit: "64kb" } } };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optionalEmail(value, field) {
  const email = asText(value, field, { max: 200 });
  if (email && !EMAIL.test(email)) throw new HttpError(400, `${field} inválido`);
  return email;
}

async function audit(supabase, params) {
  const { error } = await supabase.rpc("condominio_auditar", params);
  if (error) throw new Error(error.message);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const condominioId = asUuid(req.query.id, "condominio_id");
    const body = assertJsonBody(req, 64 * 1024);
    const request = requestId(req);
    let permission;
    if (["upsert_unidad", "editar_condominio"].includes(body.action)) permission = "editar";
    else if (body.action === "upsert_miembro") permission = "administrar_usuarios";
    else throw new HttpError(400, "Acción no soportada");
    const context = await requireCondominioPermission(req, condominioId, permission);
    await enforceRateLimit(context.supabase, `resource:${context.user.id}:${condominioId}`, 60, 60);

    if (body.action === "upsert_unidad") {
      const unitId = body.id ? asUuid(body.id, "unidad_id") : null;
      const row = {
        condominio_id: condominioId,
        numero: asText(body.numero, "número", { required: true, min: 1, max: 40 }),
        piso: asText(body.piso, "piso", { max: 40 }),
        propietario_nombre: asText(body.propietario_nombre, "propietario", { max: 160 }),
        propietario_email: optionalEmail(body.propietario_email, "correo del propietario"),
        propietario_telefono: asText(body.propietario_telefono, "teléfono", { max: 40 }),
        residente_nombre: asText(body.residente_nombre, "residente", { max: 160 }),
        residente_email: optionalEmail(body.residente_email, "correo del residente"),
        residente_telefono: asText(body.residente_telefono, "teléfono del residente", { max: 40 }),
        residente_es_propietario: Boolean(body.residente_es_propietario),
        notas: asText(body.notas, "notas", { max: 1000 }),
        activo: body.activo !== false,
      };
      let before = null;
      if (unitId) {
        const { data } = await context.supabase.from("unidades_condominio").select("*").eq("id", unitId).eq("condominio_id", condominioId).maybeSingle();
        if (!data) throw new HttpError(404, "Unidad no encontrada");
        before = data;
      }
      const query = unitId
        ? context.supabase.from("unidades_condominio").update(row).eq("id", unitId).eq("condominio_id", condominioId)
        : context.supabase.from("unidades_condominio").insert(row);
      const { data, error } = await query.select("*").single();
      if (error) throw new Error(error.message);
      await audit(context.supabase, {
        p_actor: context.user.id, p_condominio: condominioId, p_unidad: data.id,
        p_accion: unitId ? "editar_unidad" : "crear_unidad", p_entidad: "unidades_condominio",
        p_entidad_id: data.id, p_motivo: null, p_antes: before, p_despues: data, p_request_id: request,
      });
      return res.status(unitId ? 200 : 201).json({ ok: true, data });
    }

    if (body.action === "upsert_miembro") {
      const memberId = body.id ? asUuid(body.id, "miembro_id") : null;
      const userId = asUuid(body.user_id, "user_id");
      const unitId = body.unidad_id ? asUuid(body.unidad_id, "unidad_id") : null;
      const roles = [
        "administrador_general","lider_cuenta","cobranza","mantenimiento",
        "juridico","comite","condomino","residente","solo_lectura",
      ];
      if (!roles.includes(body.rol)) throw new HttpError(400, "Rol inválido");
      if (["condomino", "residente"].includes(body.rol) && !unitId) throw new HttpError(400, "El rol requiere una unidad");
      const motivo = asText(body.motivo, "motivo", { required: true, min: 8, max: 500 });
      const { data, error } = await context.supabase.rpc("condominio_upsert_miembro", {
        p_actor: context.user.id,
        p_condominio: condominioId,
        p_id: memberId,
        p_user: userId,
        p_unidad: unitId,
        p_rol: body.rol,
        p_activo: body.activo !== false,
        p_motivo: motivo,
        p_request_id: request,
      });
      if (error) throw new Error(error.message);
      return res.status(memberId ? 200 : 201).json({ ok: true, data });
    }

    const { data: before, error: beforeError } = await context.supabase.from("condominios").select("*").eq("id", condominioId).single();
    if (beforeError) throw new Error(beforeError.message);
    const updates = {
      nombre: asText(body.nombre, "nombre", { required: true, min: 3, max: 180 }),
      direccion: asText(body.direccion, "dirección", { max: 300 }),
      notas: asText(body.notas, "notas", { max: 1000 }),
    };
    const { data, error } = await context.supabase.from("condominios").update(updates).eq("id", condominioId).select("*").single();
    if (error) throw new Error(error.message);
    await audit(context.supabase, {
      p_actor: context.user.id, p_condominio: condominioId, p_unidad: null,
      p_accion: "editar", p_entidad: "condominios", p_entidad_id: condominioId,
      p_motivo: null, p_antes: before, p_despues: data, p_request_id: request,
    });
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    return sendApiError(res, error);
  }
}
