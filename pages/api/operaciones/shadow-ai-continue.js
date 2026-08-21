import { createClient } from "@supabase/supabase-js";
import { DEV_PROJECT_REF, assertSupabaseEnvironment, getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { continueShadowAiStateMachine } from "../../../lib/shadow/ai/stateMachine";
import { SHADOW_AI_PROMPT_VERSION } from "../../../lib/shadow/ai/prompt";

export const config = { maxDuration: 120 };
const client = (key, token) => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined, auth: { persistSession: false, autoRefreshToken: false } });
async function authorize(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""); const auth = client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, token);
  const { data: { user } } = await auth.auth.getUser(token); if (!user) return false;
  const { data } = await auth.from("profiles").select("role_id,active").eq("id", user.id).maybeSingle();
  return Boolean(data?.active && ["admin", "coord_operaciones"].includes(data.role_id));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido." });
  try {
    const environment = assertSupabaseEnvironment();
    if (environment.projectRef !== DEV_PROJECT_REF || environment.env === "production") return res.status(403).json({ ok: false, error: "Continuación P3 bloqueada fuera de DEV." });
    if (process.env.SHADOW_AI_ALLOW_REAL_MESSAGES !== "false" || process.env.SHADOW_OUTBOUND_ENABLED !== "false") return res.status(403).json({ ok: false, error: "Guardas Shadow inválidas." });
    if (!await authorize(req)) return res.status(403).json({ ok: false, error: "No autorizado." });
    const runId = String(req.body?.runId || ""); if (!/^[0-9a-f-]{36}$/i.test(runId)) return res.status(400).json({ ok: false, error: "runId inválido." });
    const admin = getAdminSupabase();
    const { data: owned, error } = await admin.from("shadow_ai_runs").select("id,message_id,prompt_version").eq("id", runId).maybeSingle();
    if (error) throw error;
    const { data: message, error: messageError } = owned ? await admin.from("shadow_messages").select("provider,provider_metadata").eq("id", owned.message_id).maybeSingle() : { data: null, error: null };
    if (messageError) throw messageError;
    if (!owned || owned.prompt_version !== SHADOW_AI_PROMPT_VERSION || message?.provider !== "synthetic" || !message?.provider_metadata?.syntheticScenario) return res.status(403).json({ ok: false, error: "Run fuera del conjunto QA actual." });
    const result = await continueShadowAiStateMachine(admin, runId);
    const status = result.status === "already_running" ? 409 : result.status?.startsWith("blocked_") ? 409 : 200;
    return res.status(status).json({ ok: status === 200, ...result });
  } catch (error) {
    console.error("[shadow-ai-continue]", error?.message || error);
    return res.status(500).json({ ok: false, error: "No se pudo continuar el run Shadow." });
  }
}
