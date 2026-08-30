import { createClient } from "@supabase/supabase-js";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { sameOriginAdminRequest } from "../../../lib/shadow/identityBootstrap.js";
import { anthropicShadowAiDecisionJsonSchema } from "../../../lib/shadow/ai/schema.js";
import { REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "../../../lib/shadow/ai/realPrompt.js";

export const config = { maxDuration: 50 };
const MODEL = "claude-haiku-4-5-20251001";
const clean = (value, max = 120) => String(value || "").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, max) || null;
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const syntheticContext = { inputKind: "conversational_message", message: "Consulta administrativa sintética sobre una entrega y un importe; no contiene datos reales.", metadata: { priorConversation: [], attachmentContext: { present: false, interpreted: false, items: [] } }, deterministic: { intent: "consulta_pago", interactionDirection: "ambiguous_actor", requiresHuman: true, reasonCodes: ["synthetic_diagnostic"] }, tools: [], evidenceLedger: [], round: 1, remainingRounds: 2 };
function bodyFor(stage) {
  const body = { model: MODEL, max_tokens: stage === 5 ? 1400 : 8, messages: [{ role: "user", content: stage === 5 ? JSON.stringify(syntheticContext) : "responde OK" }] };
  if (stage >= 2) body.system = REAL_SHADOW_AI_SYSTEM_PROMPT;
  if (stage >= 3) body.output_config = { format: { type: "json_schema", schema: anthropicShadowAiDecisionJsonSchema } };
  if (stage >= 4) body.system = `${REAL_SHADOW_AI_SYSTEM_PROMPT}\n\n${REAL_SHADOW_AI_TOOL_GUIDE}`;
  return body;
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const actor = await authorizeShadowAdministrator(req);
  if (!actor || !sameOriginAdminRequest(req)) return res.status(403).json({ ok: false, error: "not_authorized" });
  const stage = Number(req.body?.stage); const environment = process.env.VERCEL_ENV;
  if (![1, 2, 3, 4, 5].includes(stage) || !["production", "preview"].includes(environment)) return res.status(400).json({ ok: false, error: "invalid_stage_or_environment" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, error: "anthropic_key_missing" });
  const body = JSON.stringify(bodyFor(stage)); const db = admin();
  const { error: claimError } = await db.from("shadow_anthropic_staged_diagnostic_temp").insert({ environment, stage, body_bytes: Buffer.byteLength(body) });
  if (claimError) return res.status(409).json({ ok: false, error: "stage_already_claimed" });
  const started = Date.now(); let result;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: AbortSignal.timeout(40000), headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body });
    const headersAt = Date.now(); let usage = null;
    if (response.ok) { const providerBody = await response.json(); usage = { input_tokens: Number(providerBody?.usage?.input_tokens || 0), output_tokens: Number(providerBody?.usage?.output_tokens || 0) }; } else await response.body?.cancel?.();
    result = { body_bytes: Buffer.byteLength(body), provider_status: response.status, provider_request_id: clean(response.headers.get("request-id")), time_to_headers_ms: headersAt - started, total_ms: Date.now() - started, input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null, timeout_class: null };
  } catch (error) {
    result = { body_bytes: Buffer.byteLength(body), provider_status: null, provider_request_id: null, time_to_headers_ms: null, total_ms: Date.now() - started, input_tokens: null, output_tokens: null, timeout_class: clean(error?.cause?.code || error?.code || error?.name, 60) };
  }
  const { error: persistError } = await db.from("shadow_anthropic_staged_diagnostic_temp").update({ ...result, completed_at: new Date().toISOString() }).eq("environment", environment).eq("stage", stage);
  if (persistError) return res.status(500).json({ ok: false, error: "telemetry_persist_failed" });
  return res.status(200).json({ stage, environment, ...result });
}
