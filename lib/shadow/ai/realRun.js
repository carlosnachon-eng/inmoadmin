import { PROD_PROJECT_REF } from "../../ejecutivo/workCenter.js";
import { REAL_SHADOW_AI_PROMPT_VERSION, REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "./realPrompt.js";
import { loadRealShadowMessage, realShadowEnvelope, realShadowMessageEligibility } from "./realMessage.js";
import { continueShadowAiStateMachine, startShadowAiStateMachine } from "./stateMachine.js";

export function assertRealShadowRunEnvironment(env = process.env) {
  const projectRef = String(env.NEXT_PUBLIC_SUPABASE_URL || "").match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i)?.[1] || null;
  if (env.VERCEL_ENV !== "production" || env.SUPABASE_ENVIRONMENT !== "production" || projectRef !== PROD_PROJECT_REF) throw new Error("real_shadow_production_environment_required");
  if (env.SHADOW_AI_ENABLED !== "true" || env.SHADOW_AI_PRODUCTION_ENABLED !== "true" || env.SHADOW_AI_ALLOW_REAL_MESSAGES !== "true") throw new Error("real_shadow_flags_disabled");
  if (env.SHADOW_OUTBOUND_ENABLED === "true") throw new Error("real_shadow_outbound_block");
  if (env.SHADOW_AI_ALLOW_OPERATIONAL_EVENTS === "true") throw new Error("real_shadow_mixed_input_block");
  return { env: "production", projectRef };
}

const options = (env) => ({ env, promptVersion: REAL_SHADOW_AI_PROMPT_VERSION, systemPrompt: REAL_SHADOW_AI_SYSTEM_PROMPT, toolGuide: REAL_SHADOW_AI_TOOL_GUIDE, inputMode: "manual_real_shadow", allowRetry: false });

export async function startRealShadowMessageRun(admin, messageId, env = process.env) {
  assertRealShadowRunEnvironment(env);
  const stored = await loadRealShadowMessage(admin, messageId);
  const eligibility = realShadowMessageEligibility({ ...stored, env });
  if (!eligibility.allowed) return { status: eligibility.reason };
  return startShadowAiStateMachine(admin, { messageId: stored.message.id, envelope: realShadowEnvelope(stored.message, stored.conversation) }, options(env));
}

export async function continueRealShadowMessageRun(admin, runId, env = process.env) {
  assertRealShadowRunEnvironment(env);
  const { data: run, error } = await admin.from("shadow_ai_runs").select("id,message_id,operational_event_id,input_kind,status,execution_state,prompt_version,model,campaign_id").eq("id", runId).maybeSingle();
  if (error) throw error;
  if (!run || !run.message_id || run.operational_event_id || run.input_kind !== "conversational_message" || run.campaign_id || run.prompt_version !== REAL_SHADOW_AI_PROMPT_VERSION || run.execution_state !== "awaiting_model_round") return { status: "real_run_not_continuable" };
  const stored = await loadRealShadowMessage(admin, run.message_id);
  const eligibility = realShadowMessageEligibility({ ...stored, env });
  if (!eligibility.allowed) return { status: eligibility.reason };
  return continueShadowAiStateMachine(admin, runId, options(env));
}
