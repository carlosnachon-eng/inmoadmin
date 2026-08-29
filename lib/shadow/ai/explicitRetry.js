import { DEFAULT_SHADOW_AI_MODEL } from "./anthropic.js";
import { loadAutoRealTurns } from "./autoReal.js";
import { REAL_SHADOW_AUTO_AI_PROMPT_VERSION, REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "./realPrompt.js";
import { realShadowTurnEnvelope } from "./conversationTurns.js";
import { resolveConfirmedContactIdentity } from "../identityBridge.js";
import { startShadowAiStateMachine } from "./stateMachine.js";

export const EXPLICIT_RETRY_REASON = "explicit_user_authorized";
export const EXPLICIT_RETRY_RUNTIME = "administradora-ia-emporio-real-shadow-v10";
const RETRYABLE_ERROR = /(?:timeout|connection|connect|headers_first_byte|body_response|econnreset|etimedout|eai_again)/i;
const ACTIVE_ACTION_STATUSES = ["proposed", "approved_for_future_auto", "sent"];

const runtimeEnv = (env) => ({ ...env, SHADOW_AI_ENABLED: "true", SHADOW_AI_PRODUCTION_ENABLED: "true", SHADOW_AI_ALLOW_REAL_MESSAGES: "true", SHADOW_AI_ALLOW_OPERATIONAL_EVENTS: "false", SHADOW_OUTBOUND_ENABLED: "false", SHADOW_ADMIN_WORK_R1_ENABLED: "false" });
const safeReason = (value) => String(value || "").replace(/[^a-z0-9_:-]/gi, "_").slice(0, 80) || "unknown";

export function evaluateExplicitRetryFacts(facts = {}) {
  if (!facts.parentFound) return failed("parent_not_found");
  if (!facts.turnKeyPresent) return failed("parent_turn_missing");
  if (!facts.parentRetryable) return failed("parent_not_retryable");
  if (facts.parentIsChild) return failed("retry_child_not_retryable");
  if (facts.childExists) return failed("authorized_retry_already_exists");
  if (facts.newerRunExists) return failed("newer_run_after_parent");
  if (facts.successfulRunAfter) return failed("successful_run_after_parent");
  if (!facts.turnCurrent) return failed("turn_not_operationally_current");
  if (facts.humanResponseAfter) return failed("human_response_after_parent");
  if (facts.outboundAfter) return failed("outbound_after_parent");
  if (facts.activeActionExists) return failed("active_conversation_action_exists");
  if (facts.newerInboundAfter) return failed("newer_inbound_after_turn");
  if (!facts.mediaSettled) return failed("media_not_settled");
  if (!facts.identityDependencyPresent || !facts.identityResolved) return failed("identity_not_resolved");
  if (!facts.operationalContextResolved) return failed("operational_context_not_resolved");
  return { eligible: true, reason: "eligible" };
}

export function assertExplicitRetryEnvironment(env = process.env) {
  if (env.SHADOW_AI_EXPLICIT_RETRY_ENABLED !== "true") throw new Error("explicit_retry_kill_switch_disabled");
  if (env.SHADOW_OUTBOUND_ENABLED === "true" || env.SHADOW_ADMIN_OUTBOUND_ENABLED === "true") throw new Error("explicit_retry_outbound_must_remain_off");
  if (env.SHADOW_ADMIN_WORK_R1_ENABLED === "true") throw new Error("explicit_retry_r1_must_remain_off");
  if (env.SUPABASE_ENVIRONMENT === "dev" && env.VERCEL_ENV === "preview") return { mode: "dev" };
  if (env.SUPABASE_ENVIRONMENT === "production" && env.VERCEL_ENV === "production") return { mode: "production" };
  throw new Error("explicit_retry_environment_mismatch");
}

const failed = (reason, details = {}) => ({ eligible: false, reason, ...details });

export async function inspectExplicitRetry(admin, parentRunId, { env = process.env, now = Date.now(), loadTurns = loadAutoRealTurns } = {}) {
  const { data: parent, error } = await admin.from("shadow_ai_runs")
    .select("id,message_id,status,execution_state,error_sanitized,model,prompt_version,telemetry_json,created_at,completed_at,parent_run_id,retry_reason")
    .eq("id", parentRunId).maybeSingle();
  if (error) throw error;
  if (!parent) return failed("parent_not_found");
  const turnKey = String(parent.telemetry_json?.turn_key || "");
  if (!turnKey || !parent.message_id) return failed("parent_turn_missing");
  const retryable = parent.status === "timeout" || (parent.status === "error" && RETRYABLE_ERROR.test(String(parent.error_sanitized || parent.telemetry_json?.failure?.timeout_class || "")));
  if (!retryable || !["error", "timeout"].includes(parent.execution_state)) return failed("parent_not_retryable", { parent, turnKey });
  if (parent.parent_run_id || parent.retry_reason) return failed("retry_child_not_retryable", { parent, turnKey });

  const model = env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL;
  const [{ data: laterRuns, error: laterError }, { data: child, error: childError }, loaded] = await Promise.all([
    admin.from("shadow_ai_runs").select("id,status,created_at,telemetry_json").gt("created_at", parent.created_at).eq("model", model).eq("prompt_version", REAL_SHADOW_AUTO_AI_PROMPT_VERSION).order("created_at", { ascending: false }),
    admin.from("shadow_ai_runs").select("id,status").eq("parent_run_id", parent.id).eq("retry_turn_key", turnKey).eq("retry_runtime_version", EXPLICIT_RETRY_RUNTIME).limit(1).maybeSingle(),
    loadTurns(admin, { env, now, inputMode: "auto_real_shadow" }),
  ]);
  if (laterError || childError) throw laterError || childError;
  if (child) return failed("authorized_retry_already_exists", { parent, turnKey, childRunId: child.id });
  if ((laterRuns || []).some((run) => run.status === "completed" && run.telemetry_json?.turn_key === turnKey)) return failed("successful_run_after_parent", { parent, turnKey });
  if ((laterRuns || []).some((run) => run.telemetry_json?.turn_key === turnKey)) return failed("newer_run_after_parent", { parent, turnKey });

  const turn = loaded.turns.find((item) => item.turnKey === turnKey);
  if (!turn) return failed("turn_not_operationally_current", { parent, turnKey });
  if (turn.humanResponseId) return failed("human_response_after_parent", { parent, turnKey });
  if (turn.mediaSettlement?.status === "waiting") return failed("media_not_settled", { parent, turnKey });
  const conversation = loaded.conversations.find((item) => item.id === turn.conversationId);
  if (!conversation?.respond_contact_id) return failed("identity_dependency_missing", { parent, turnKey });
  const laterInbound = loaded.messages.some((message) => message.conversation_id === turn.conversationId && message.direction === "inbound" && !turn.messageIds.includes(message.id) && Date.parse(message.occurred_at) > Date.parse(turn.lastInboundAt));
  if (laterInbound) return failed("newer_inbound_after_turn", { parent, turnKey });

  const [{ data: actions, error: actionError }, { data: outbound, error: outboundError }, identity] = await Promise.all([
    admin.from("shadow_conversation_actions").select("id,status").eq("turn_key", turnKey).in("status", ACTIVE_ACTION_STATUSES).limit(1),
    admin.from("shadow_admin_outbound_messages").select("id,status").eq("turn_key", turnKey).limit(1),
    resolveConfirmedContactIdentity(admin, conversation.respond_contact_id, { audit: false }),
  ]);
  if (actionError || outboundError) throw actionError || outboundError;
  if ((outbound || []).length) return failed("outbound_after_parent", { parent, turnKey });
  if ((actions || []).length) return failed("active_conversation_action_exists", { parent, turnKey });
  if (!identity.resolved) return failed("identity_not_resolved", { parent, turnKey });
  if (identity.ambiguousPropertyContext || !identity.properties?.length) return failed("operational_context_not_resolved", { parent, turnKey });

  return { eligible: true, reason: "eligible", parent, turnKey, turn, conversation, identity: { clientIdentityId: identity.clientContextKey, roles: identity.roles, contracts: identity.contracts, properties: identity.properties } };
}

export async function executeExplicitRetry(admin, { parentRunId, actorProfileId, authorization }, { env = process.env, now = Date.now(), loadTurns, startRun = startShadowAiStateMachine, inspectRetry = inspectExplicitRetry } = {}) {
  assertExplicitRetryEnvironment(env);
  if (authorization !== EXPLICIT_RETRY_REASON) return failed("explicit_authorization_required");
  const inspected = await inspectRetry(admin, parentRunId, { env, now, loadTurns });
  if (!inspected.eligible) {
    await admin.from("shadow_ai_explicit_retry_audit").insert({ parent_run_id: parentRunId, actor_profile_id: actorProfileId, event_type: "blocked", reason_code: safeReason(inspected.reason), runtime_version: EXPLICIT_RETRY_RUNTIME, turn_key: inspected.turnKey || null });
    return inspected;
  }
  const { parent, turn, conversation, turnKey } = inspected;
  const result = await startRun(admin, { messageId: turn.anchorMessageId, envelope: realShadowTurnEnvelope(turn, conversation, env) }, {
    env: runtimeEnv(env), promptVersion: REAL_SHADOW_AUTO_AI_PROMPT_VERSION, systemPrompt: REAL_SHADOW_AI_SYSTEM_PROMPT,
    toolGuide: REAL_SHADOW_AI_TOOL_GUIDE, inputMode: "auto_real_explicit_retry", allowRetry: false,
    retryAuthorization: EXPLICIT_RETRY_REASON, persistInputSnapshot: true, idempotencyIdentity: `turn:${turnKey}`,
    turnMetadata: { turnKey, messageIds: turn.messageIds, humanResponseId: null, closedReason: turn.closedReason, mediaSettlement: turn.mediaSettlement || null },
    explicitRetryMetadata: { parent_run_id: parent.id, retry_reason: EXPLICIT_RETRY_REASON, retry_turn_key: turnKey, retry_runtime_version: EXPLICIT_RETRY_RUNTIME, retry_authorized_by: actorProfileId, retry_authorized_at: new Date(now).toISOString() },
  });
  await admin.from("shadow_ai_explicit_retry_audit").insert({ parent_run_id: parent.id, child_run_id: result.runId || null, actor_profile_id: actorProfileId, event_type: result.runId ? "executed" : "blocked", reason_code: safeReason(result.status), runtime_version: EXPLICIT_RETRY_RUNTIME, turn_key: turnKey });
  return { ...result, eligible: true, parentRunId: parent.id, turnKey };
}

export async function listExplicitRetryCandidates(admin, options = {}) {
  const { data, error } = await admin.from("shadow_ai_runs").select("id,created_at,status").in("status", ["timeout", "error"]).is("parent_run_id", null).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  const inspected = [];
  for (const row of data || []) {
    const result = await inspectExplicitRetry(admin, row.id, options);
    inspected.push({ runId: row.id, runRef: row.id.slice(0, 12), createdAt: row.created_at, status: row.status, eligible: result.eligible, reason: result.reason, turnRef: result.turnKey?.slice(0, 12) || null });
  }
  return inspected;
}
