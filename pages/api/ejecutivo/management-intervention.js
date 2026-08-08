import {
  assertDevSupabaseUrl,
  authHeaderToken,
  getAdminSupabase,
  getServerSupabase,
} from "../../../lib/ejecutivo/workCenter";

const ALLOWED_STATUS = new Set(["pendiente", "en_seguimiento", "corregida", "sin_mejora", "cerrada_decision_tomada"]);

function rejectInternal(res, err) {
  console.error("[management-intervention]", err?.message || err);
  return res.status(500).json({ ok: false, error: "No se pudo registrar la intervención DEV." });
}

export default async function handler(req, res) {
  if (!["POST", "PATCH"].includes(req.method)) return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    assertDevSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const jwt = authHeaderToken(req);
    if (!jwt) return res.status(401).json({ ok: false, error: "Sesion requerida." });

    const scoped = getServerSupabase(jwt);
    const admin = getAdminSupabase();
    const { data: { user }, error: userError } = await scoped.auth.getUser();
    if (userError || !user) return res.status(401).json({ ok: false, error: "Sesion invalida." });

    const { data: actorProfile, error: actorError } = await admin
      .from("profiles")
      .select("id, email, full_name, role_id, active")
      .eq("id", user.id)
      .maybeSingle();
    if (actorError) throw actorError;
    if (!actorProfile?.active || !["admin", "gerente_ventas"].includes(actorProfile.role_id)) {
      return res.status(403).json({ ok: false, error: "Intervención no autorizada." });
    }

    if (req.method === "POST") {
      const { advisorProfileId, reason, agreedAction, reviewOn = null, notes = "", indicators = {} } = req.body || {};
      if (!advisorProfileId || !reason || !agreedAction) return res.status(400).json({ ok: false, error: "Faltan datos mínimos." });

      const { data: visibleAdvisor, error: advisorError } = await scoped
        .from("profiles")
        .select("id")
        .eq("id", advisorProfileId)
        .maybeSingle();
      if (advisorError) throw advisorError;
      if (!visibleAdvisor && actorProfile.role_id !== "admin") return res.status(403).json({ ok: false, error: "Asesor fuera del scope autorizado." });

      const { data, error } = await scoped
        .from("gv_management_interventions")
        .insert({
          advisor_profile_id: advisorProfileId,
          actor_profile_id: actorProfile.id,
          scope: "ventas",
          reason: String(reason).slice(0, 220),
          agreed_action: String(agreedAction).slice(0, 220),
          review_on: reviewOn || null,
          status: "pendiente",
          indicators,
          notes: String(notes || "").slice(0, 500) || null,
        })
        .select("id, status, created_at")
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, dev: true, intervention: data });
    }

    const { id, status } = req.body || {};
    if (!id || !ALLOWED_STATUS.has(status)) return res.status(400).json({ ok: false, error: "Estatus no válido." });
    const { data, error } = await scoped
      .from("gv_management_interventions")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, status, updated_at")
      .single();
    if (error) throw error;
    return res.status(200).json({ ok: true, dev: true, intervention: data });
  } catch (err) {
    return rejectInternal(res, err);
  }
}
