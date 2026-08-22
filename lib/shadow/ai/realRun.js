import { REAL_SHADOW_AI_PROMPT_VERSION, REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "./realPrompt.js";
import { loadRealShadowMessage, realShadowEnvelope, realShadowMessageEligibility } from "./realMessage.js";
import { continueShadowAiStateMachine, startShadowAiStateMachine } from "./stateMachine.js";
import { assertManualAuthorizationEnvironment, consumeManualRealAuthorization, manualAuthorizedRuntimeEnv } from "./manualAuthorization.js";

export function assertRealShadowRunEnvironment(env = process.env) {
  const context = assertManualAuthorizationEnvironment(env);
  if (context.mode !== "production") throw new Error("real_shadow_production_environment_required");
  return context;
}

const options = (env) => ({ env: manualAuthorizedRuntimeEnv(env), promptVersion: REAL_SHADOW_AI_PROMPT_VERSION, systemPrompt: REAL_SHADOW_AI_SYSTEM_PROMPT, toolGuide: REAL_SHADOW_AI_TOOL_GUIDE, inputMode: "manual_real_shadow_authorized", allowRetry: false });

export async function startRealShadowMessageRun(admin, messageId, authorizationId, env = process.env) {
  assertRealShadowRunEnvironment(env);
  const stored = await loadRealShadowMessage(admin, messageId);
  const eligibility = realShadowMessageEligibility({ ...stored, env });
  if (!eligibility.allowed) return { status: eligibility.reason };
  const runOptions = options(env);
  runOptions.beforeExecuteRun = ({ runId, model, promptVersion }) => consumeManualRealAuthorization(admin, { authorizationId, messageId, runId, model, promptVersion });
  return startShadowAiStateMachine(admin, { messageId: stored.message.id, envelope: realShadowEnvelope(stored.message, stored.conversation) }, runOptions);
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
