import {
  assertDevSupabaseUrl,
  authHeaderToken,
  getAdminSupabase,
  getServerSupabase,
} from "../../../lib/ejecutivo/workCenter";

const ALLOWED_EVENT_TYPES = new Set([
  "management_intervention",
  "next_action_changed",
  "risk_changed",
  "stage_changed",
  "note",
]);

function rejectInternal(res, err) {
  console.error("[work-center-event]", err?.message || err);
  return res.status(500).json({ ok: false, error: "No se pudo registrar la auditoria DEV." });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    assertDevSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const jwt = authHeaderToken(req);
    if (!jwt) return res.status(401).json({ ok: false, error: "Sesion requerida." });

    const { opportunityId, eventType = "management_intervention", actedAsProfileId = null, notes = "" } = req.body || {};
    if (!opportunityId) return res.status(400).json({ ok: false, error: "Falta opportunityId." });
    if (!ALLOWED_EVENT_TYPES.has(eventType)) return res.status(400).json({ ok: false, error: "Tipo de evento no permitido." });

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
    if (!actorProfile?.active) return res.status(403).json({ ok: false, error: "Perfil no autorizado." });

    const { data: visibleOpp, error: visibleError } = await scoped
      .from("gv_opportunities")
      .select("id, asesor_id")
      .eq("id", opportunityId)
      .maybeSingle();
    if (visibleError) throw visibleError;
    if (!visibleOpp) return res.status(403).json({ ok: false, error: "Oportunidad fuera del scope autorizado." });

    const isManagement = actorProfile.id !== visibleOpp.asesor_id;
    const { data: event, error: insertError } = await scoped
      .from("gv_opportunity_events")
      .insert({
        opportunity_id: visibleOpp.id,
        event_type: eventType,
        actor_profile_id: actorProfile.id,
        acted_as_profile_id: isManagement ? (actedAsProfileId || visibleOpp.asesor_id) : null,
        is_management_intervention: isManagement,
        event_source: "app",
        metadata: { prototype: "fase_2a_dev", scope: "ventas" },
        notes: String(notes || "").slice(0, 500),
      })
      .select("id, occurred_at, actor_profile_id, acted_as_profile_id, is_management_intervention")
      .single();
    if (insertError) throw insertError;

    return res.status(200).json({ ok: true, dev: true, event });
  } catch (err) {
    return rejectInternal(res, err);
  }
}
