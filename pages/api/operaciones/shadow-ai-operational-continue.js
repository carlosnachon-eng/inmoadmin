import { createClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { continueShadowAiStateMachine } from "../../../lib/shadow/ai/stateMachine";

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
    const runId = String(req.body?.runId || ""); if (!UUID.test(runId)) return res.status(400).json({ ok: false, error: "runId inválido." });
    const admin = getAdminSupabase();
    const { data: run, error } = await admin.from("shadow_ai_runs").select("id,input_kind,operational_event_id").eq("id", runId).maybeSingle();
    if (error) throw error;
    if (!run || run.input_kind !== "operational_event" || !run.operational_event_id) return res.status(403).json({ ok: false, error: "Run no operativo." });
    const result = await continueShadowAiStateMachine(admin, runId);
    const status = result.status === "already_running" || result.status?.startsWith("blocked_") ? 409 : 200;
    return res.status(status).json({ ok: status === 200, ...result });
  } catch (error) {
    console.error("[shadow-ai-operational-continue]", error?.message || error);
    return res.status(500).json({ ok: false, error: "No se pudo continuar el análisis operativo Shadow." });
  }
}
