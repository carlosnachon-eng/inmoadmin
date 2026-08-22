import { createClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { startOperationalShadowAiStateMachine } from "../../../lib/shadow/ai/stateMachine";

export const config = { maxDuration: 120 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function authorized(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: { user } } = await auth.auth.getUser(token); if (!user) return false;
  const { data } = await auth.from("profiles").select("role_id,active").eq("id", user.id).maybeSingle();
  return Boolean(data?.active && ["admin", "coord_operaciones"].includes(data.role_id));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido." });
  try {
    if (!await authorized(req)) return res.status(403).json({ ok: false, error: "No autorizado." });
    if (process.env.SHADOW_OUTBOUND_ENABLED === "true" || process.env.SHADOW_AI_ALLOW_REAL_MESSAGES === "true") return res.status(403).json({ ok: false, error: "Guardas Shadow incompatibles." });
    const operationalEventId = String(req.body?.operationalEventId || "");
    if (!UUID.test(operationalEventId)) return res.status(400).json({ ok: false, error: "operationalEventId inválido." });
    const admin = getAdminSupabase();
    const { data: event, error } = await admin.from("shadow_operational_events")
      .select("id,source,kind,event_type,payload_safe,occurred_at").eq("id", operationalEventId).maybeSingle();
    if (error) throw error;
    if (!event) return res.status(404).json({ ok: false, error: "Evento operativo no encontrado." });
    const result = await startOperationalShadowAiStateMachine(admin, event);
    return res.status(result.status === "running" ? 409 : 200).json({ ok: true, ...result });
  } catch (error) {
    console.error("[shadow-ai-operational-run]", error?.message || error);
    return res.status(500).json({ ok: false, error: "No se pudo iniciar el análisis operativo Shadow." });
  }
}
