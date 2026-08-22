import { PROD_PROJECT_REF } from "../../ejecutivo/workCenter.js";
import { DEFAULT_SHADOW_AI_MODEL } from "./anthropic.js";
import { REAL_SHADOW_AI_PROMPT_VERSION } from "./realPrompt.js";
import { loadRealShadowMessage, realShadowDevCloneEligibility, realShadowMessageEligibility } from "./realMessage.js";

export const REAL_MANUAL_AUTHORIZATION_PURPOSE = "real_shadow_manual";
export const REAL_MANUAL_AUTHORIZATION_TTL_SECONDS = 600;
export const DEV_PROJECT_REF = "hjfwjnejbcpmknvfpdcq";

const projectRef = (env) => String(env.NEXT_PUBLIC_SUPABASE_URL || "").match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i)?.[1] || null;

export function assertManualAuthorizationEnvironment(env = process.env) {
  if (env.SHADOW_AI_MANUAL_REAL_ENABLED !== "true") throw new Error("manual_real_kill_switch_disabled");
  if (env.SHADOW_OUTBOUND_ENABLED === "true") throw new Error("manual_real_outbound_block");
  if (env.SHADOW_AI_ALLOW_OPERATIONAL_EVENTS === "true") throw new Error("manual_real_operational_events_block");
  if (env.SHADOW_AI_ENABLED === "true" || env.SHADOW_AI_PRODUCTION_ENABLED === "true" || env.SHADOW_AI_ALLOW_REAL_MESSAGES === "true") throw new Error("manual_real_global_ai_flags_must_remain_off");
  const ref = projectRef(env);
  if (env.VERCEL_ENV === "production" && env.SUPABASE_ENVIRONMENT === "production" && ref === PROD_PROJECT_REF) return { mode: "production", projectRef: ref };
  if (env.VERCEL_ENV === "preview" && env.SUPABASE_ENVIRONMENT === "dev" && ref === DEV_PROJECT_REF && env.SHADOW_REAL_MANUAL_DEV_TEST_ENABLED === "true") return { mode: "dev_test", projectRef: ref };
  throw new Error("manual_real_environment_mismatch");
}

export function manualAuthorizedRuntimeEnv(env = process.env) {
  const context = assertManualAuthorizationEnvironment(env);
  if (context.mode !== "production") throw new Error("manual_real_provider_call_production_only");
  return { ...env, SHADOW_AI_ENABLED: "true", SHADOW_AI_PRODUCTION_ENABLED: "true", SHADOW_AI_ALLOW_REAL_MESSAGES: "true", SHADOW_AI_ALLOW_OPERATIONAL_EVENTS: "false", SHADOW_OUTBOUND_ENABLED: "false" };
}

export function manualAuthorizationState(row, now = Date.now()) {
  if (!row) return "none";
  if (row.consumed_at) return "consumed";
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at).getTime() <= now) return "expired";
  return "active";
}

export async function authorizeManualRealMessage(admin, messageId, actorId, env = process.env) {
  const context = assertManualAuthorizationEnvironment(env);
  const stored = await loadRealShadowMessage(admin, messageId);
  const eligibility = context.mode === "dev_test"
    ? realShadowDevCloneEligibility({ ...stored, env })
    : realShadowMessageEligibility({ ...stored, env });
  if (!eligibility.allowed) return { status: eligibility.reason };
  const model = env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL;
  const { data: prior, error: priorError } = await admin.from("shadow_ai_runs")
    .select("id,status,execution_state").eq("message_id", messageId).eq("model", model)
    .eq("prompt_version", REAL_SHADOW_AI_PROMPT_VERSION).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (priorError) throw priorError;
  if (prior?.status === "completed") return { status: "completed_not_authorizable", runId: prior.id };
  if (prior?.status === "running") return { status: "running_not_authorizable", runId: prior.id };
  if (prior) return { status: "failed_retry_not_supported", runId: prior.id };
  const { data, error } = await admin.rpc("authorize_shadow_ai_manual_message", {
    p_message_id: messageId, p_authorized_by: actorId, p_model: model,
    p_prompt_version: REAL_SHADOW_AI_PROMPT_VERSION, p_ttl_seconds: REAL_MANUAL_AUTHORIZATION_TTL_SECONDS,
  });
  if (error) throw error;
  return { status: "authorized", authorization: data, mode: context.mode };
}

export async function revokeManualRealAuthorization(admin, authorizationId, env = process.env) {
  assertManualAuthorizationEnvironment(env);
  const { data: existing, error: lookupError } = await admin.from("shadow_ai_manual_authorizations")
    .select("authorization_id,authorized_by,consumed_at,revoked_at,expires_at").eq("authorization_id", authorizationId).maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) return { status: "authorization_not_found" };
  if (manualAuthorizationState(existing) !== "active") return { status: `authorization_${manualAuthorizationState(existing)}` };
  const { data, error } = await admin.rpc("revoke_shadow_ai_manual_authorization", { p_authorization_id: authorizationId });
  if (error) throw error;
  return { status: "revoked", authorization: data };
}

export async function consumeManualRealAuthorization(admin, { authorizationId, messageId, runId, model, promptVersion }) {
  const { data, error } = await admin.rpc("consume_shadow_ai_manual_authorization", {
    p_authorization_id: authorizationId, p_message_id: messageId, p_ai_run_id: runId,
    p_model: model, p_prompt_version: promptVersion,
  });
  if (error) throw new Error("authorization_not_consumable");
  return data;
}
