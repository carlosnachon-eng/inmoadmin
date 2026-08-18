import { createClient } from "@supabase/supabase-js";
import { isAdministrativeWorkCenterRole } from "../../../lib/operaciones/administrativeWorkCenter";

const ACTIONS = new Set([
  "classification_corrected", "priority_corrected", "responsible_reassigned",
  "resolved", "reopened", "automation_paused", "automation_resumed",
  "manual_control_taken", "manual_control_released", "authorization_required",
  "authorization_cleared", "note_added",
]);

const clientFor = (token) => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } },
);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/, "");
  if (!token) return res.status(401).json({ ok: false, error: "Sesión requerida." });
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ ok: false, error: "Método no permitido." });
  try {
    const client = clientFor(token);
    const { data: { user }, error: authError } = await client.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ ok: false, error: "Sesión inválida." });
    const { data: profile } = await client.from("profiles").select("id, role_id, active").eq("id", user.id).maybeSingle();
    if (!profile?.active || !isAdministrativeWorkCenterRole(profile.role_id)) {
      return res.status(403).json({ ok: false, error: "Supervisión no autorizada." });
    }
    const contextKey = String(req.method === "GET" ? req.query.contextKey : req.body?.contextKey || "").trim();
    if (contextKey.length < 8 || contextKey.length > 500) return res.status(400).json({ ok: false, error: "Contexto inválido." });
    if (req.method === "GET") {
      const { data, error } = await client.from("administrative_case_actions")
        .select("id, actor_type, actor_profile_id, action_type, previous_value, new_value, notes, created_at")
        .eq("context_key", contextKey).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return res.status(200).json({ ok: true, actions: data || [] });
    }
    const actionType = String(req.body?.actionType || "");
    if (!ACTIONS.has(actionType)) return res.status(400).json({ ok: false, error: "Acción no permitida." });
    const { data, error } = await client.rpc("supervise_administrative_case", {
      p_context_key: contextKey,
      p_action_type: actionType,
      p_value: req.body?.value && typeof req.body.value === "object" ? req.body.value : {},
      p_notes: String(req.body?.notes || "").slice(0, 1000) || null,
    });
    if (error) throw error;
    return res.status(200).json({ ok: true, ...data });
  } catch (error) {
    console.error("[administrative-case-supervision]", error?.message || error);
    return res.status(500).json({ ok: false, error: "No se pudo actualizar la supervisión." });
  }
}
