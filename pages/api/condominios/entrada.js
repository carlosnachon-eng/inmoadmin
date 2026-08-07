import {
  enforceRateLimit,
  requireUser,
  sendApiError,
} from "../../../lib/server/condominiosAuth";
import { resolveCondominiosEntry } from "../../../lib/server/condominiosEntry";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });
  try {
    const context = await requireUser(req);
    await enforceRateLimit(context.supabase, `entry:${context.user.id}`, 30, 60);

    const [{ data: profile, error: profileError }, { data: memberships, error: membershipError }] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("id,active,role_id,roles:role_id(es_externo)")
        .eq("id", context.user.id)
        .maybeSingle(),
      context.supabase
        .from("condominio_miembros")
        .select("unidad_id,rol,activo")
        .eq("user_id", context.user.id)
        .eq("activo", true),
    ]);
    if (profileError || membershipError) {
      throw new Error(profileError?.message || membershipError?.message);
    }

    const destination = resolveCondominiosEntry({ profile, memberships: memberships || [] });
    return res.status(200).json({ ok: true, data: { destination } });
  } catch (error) {
    return sendApiError(res, error);
  }
}
