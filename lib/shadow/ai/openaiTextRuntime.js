import { createHash } from "node:crypto";

// Selected server-side only by the text auto-real lane. Historical/manual/media
// callers keep their existing runtime; no environment fallback to Anthropic.
export const OPENAI_TEXT_RUNTIME = "shadow-auto-openai-text-v1";
export const isOpenAiTextRun = (run) => run?.telemetry_json?.text_runtime === OPENAI_TEXT_RUNTIME;
export const isOpenAiTextOptions = (options) => options?.textRuntime === OPENAI_TEXT_RUNTIME && options?.inputMode === "auto_real_shadow";
export function shadowOpenAiModel(env = process.env) {
  const model = env.OPENAI_ADMIN_AGENT_MODEL;
  if (typeof model !== "string" || !/^gpt-[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(model) || model.length > 80 || /\d{10}|[a-f0-9]{8}-[a-f0-9]{4}/i.test(model)) throw new Error("shadow_openai_model_required");
  return model;
}
export function shadowTextTurnIdentity(turnKey) {
  if (typeof turnKey !== "string" || !/^[a-f0-9]{16,64}$/.test(turnKey)) throw new Error("shadow_text_turn_required");
  const digest = createHash("sha256").update(`shadow-auto-text-turn-v1:${turnKey}`).digest("hex");
  // Deterministic PK is the permanent reservation, including error/timeout.
  // The older partial idempotency index alone releases failed runs.
  return { key: digest, id: `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}` };
}
export const OPENAI_TEXT_OFF_GATES = Object.freeze([
  "SHADOW_OUTBOUND_ENABLED", "SHADOW_ADMIN_OUTBOUND_ENABLED", "SHADOW_ADMIN_OUTBOUND_CANARY_ENABLED",
  "SHADOW_ADMIN_WORK_R1_ENABLED", "SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED", "SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED",
  "SHADOW_IDENTITY_CONFIRMATION_ENABLED", "SHADOW_IDENTITY_LINK_REVIEW_WRITE_ENABLED", "SHADOW_AI_ALLOW_OPERATIONAL_EVENTS",
]);
export function assertOpenAiTextSafety(env) {
  if (OPENAI_TEXT_OFF_GATES.some(key => env[key] === "true")) throw new Error("shadow_text_safety_gate_blocked");
  if (env.SHADOW_CONVERSATION_ACTIONS_ENABLED !== "true") throw new Error("shadow_text_3b_required");
  if (!env.OPENAI_API_KEY) throw new Error("shadow_openai_key_missing");
  return shadowOpenAiModel(env);
}
