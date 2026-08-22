import { DEFAULT_SHADOW_AI_MODEL } from "../../../lib/shadow/ai/anthropic";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth";
import { loadRealShadowMessage, realShadowDevCloneEligibility, realShadowEnvelope } from "../../../lib/shadow/ai/realMessage";
import { REAL_SHADOW_AI_PROMPT_VERSION } from "../../../lib/shadow/ai/realPrompt";
import { shadowAiIdempotencyKey } from "../../../lib/shadow/ai/runner";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido." });
  try {
    if (!await authorizeShadowAdministrator(req)) return res.status(403).json({ ok: false, error: "No autorizado." });
    const messageId = String(req.body?.messageId || "");
    if (!UUID.test(messageId) || Object.keys(req.body || {}).some((key) => key !== "messageId")) return res.status(400).json({ ok: false, error: "Solicitud inválida." });
    const admin = getAdminSupabase();
    const stored = await loadRealShadowMessage(admin, messageId);
    const eligibility = realShadowDevCloneEligibility({ ...stored, env: process.env });
    if (!eligibility.allowed) return res.status(403).json({ ok: false, status: eligibility.reason });
    const { data: prior, error } = await admin.from("shadow_ai_runs").select("id,status,execution_state").eq("message_id", messageId).eq("model", DEFAULT_SHADOW_AI_MODEL).eq("prompt_version", REAL_SHADOW_AI_PROMPT_VERSION).is("campaign_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    const envelope = realShadowEnvelope(stored.message, stored.conversation);
    return res.status(200).json({
      ok: true,
      status: prior?.status === "completed" ? "skip_completed" : prior?.status === "running" ? "block_running" : "prepared",
      devTest: true,
      envelope: { provider: envelope.provider, direction: envelope.direction, channelId: envelope.providerMetadata.channelId, sanitized: true },
      idempotencyPrepared: Boolean(shadowAiIdempotencyKey(messageId, DEFAULT_SHADOW_AI_MODEL, null, REAL_SHADOW_AI_PROMPT_VERSION)),
      priorRunId: prior?.id || null,
    });
  } catch (error) {
    console.error("[shadow-ai-real-dev-validate]", error?.message || error);
    return res.status(403).json({ ok: false, error: "Validación Shadow DEV bloqueada." });
  }
}
