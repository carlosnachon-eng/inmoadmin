import { PROD_PROJECT_REF } from "../../ejecutivo/workCenter.js";
import { DEFAULT_SHADOW_AI_MODEL } from "./anthropic.js";
import { buildRealShadowConversationTurns, realShadowTurnEnvelope } from "./conversationTurns.js";
import { REAL_SHADOW_AI_PROMPT_VERSION, REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "./realPrompt.js";
import { continueShadowAiStateMachine, startShadowAiStateMachine } from "./stateMachine.js";

export const AUTO_REAL_MAX_TURNS_PER_INVOCATION = 1;
export const AUTO_REAL_LOOKBACK_DAYS_MAX = 5;
const DEV_REF = "hjfwjnejbcpmknvfpdcq";
const ref = (env) => String(env.NEXT_PUBLIC_SUPABASE_URL || "").match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i)?.[1] || null;

export function assertAutoRealEnvironment(env = process.env, { requireBackfill = false } = {}) {
  if (env.SHADOW_AI_AUTO_REAL_ENABLED !== "true") throw new Error("auto_real_kill_switch_disabled");
  if (requireBackfill && env.SHADOW_AI_BACKFILL_REAL_ENABLED !== "true") throw new Error("auto_real_backfill_disabled");
  if (env.SHADOW_OUTBOUND_ENABLED === "true" || env.SHADOW_AI_ALLOW_OPERATIONAL_EVENTS === "true") throw new Error("auto_real_safety_flags_blocked");
  if (env.SHADOW_AI_ENABLED === "true" || env.SHADOW_AI_PRODUCTION_ENABLED === "true" || env.SHADOW_AI_ALLOW_REAL_MESSAGES === "true") throw new Error("auto_real_global_ai_flags_must_remain_off");
  const projectRef = ref(env);
  if (env.VERCEL_ENV === "production" && env.SUPABASE_ENVIRONMENT === "production" && projectRef === PROD_PROJECT_REF) return { mode: "production", projectRef };
  if (env.VERCEL_ENV === "preview" && env.SUPABASE_ENVIRONMENT === "dev" && projectRef === DEV_REF && env.SHADOW_AI_AUTO_REAL_DEV_TEST_ENABLED === "true") return { mode: "dev_test", projectRef };
  throw new Error("auto_real_environment_mismatch");
}

const runtimeEnv = (env) => ({ ...env, SHADOW_AI_ENABLED: "true", SHADOW_AI_PRODUCTION_ENABLED: "true", SHADOW_AI_ALLOW_REAL_MESSAGES: "true", SHADOW_AI_ALLOW_OPERATIONAL_EVENTS: "false", SHADOW_OUTBOUND_ENABLED: "false" });
const runOptions = (env, turn, inputMode) => ({
  env: runtimeEnv(env), promptVersion: REAL_SHADOW_AI_PROMPT_VERSION, systemPrompt: REAL_SHADOW_AI_SYSTEM_PROMPT,
  toolGuide: REAL_SHADOW_AI_TOOL_GUIDE, inputMode, allowRetry: false,
  idempotencyIdentity: `turn:${turn.turnKey}`, turnMetadata: { turnKey: turn.turnKey, messageIds: turn.messageIds, humanResponseId: turn.humanResponseId, closedReason: turn.closedReason },
});

export function autoRealRunDisposition(run) {
  if (!run) return "pending";
  if (run.status === "completed") return "skip_completed";
  if (run.status === "running") return "block_running";
  if (["error", "timeout"].includes(run.status)) return "report_failed_no_retry";
  return "blocked_previous_status";
}

export async function loadAutoRealTurns(admin, { lookbackDays = AUTO_REAL_LOOKBACK_DAYS_MAX, env = process.env, now = Date.now() } = {}) {
  const days = Math.max(1, Math.min(AUTO_REAL_LOOKBACK_DAYS_MAX, Number(lookbackDays || AUTO_REAL_LOOKBACK_DAYS_MAX)));
  const since = new Date(now - days * 86400000).toISOString();
  const [{ data: messages, error: messageError }, { data: conversations, error: conversationError }, { data: runs, error: runError }] = await Promise.all([
    admin.from("shadow_messages").select("id,conversation_id,direction,occurred_at,sanitized_text,attachment_metadata,provider_metadata,external_message_id").gte("occurred_at", since).order("occurred_at", { ascending: true }).limit(1000),
    admin.from("shadow_conversations").select("id,provider,channel"),
    admin.from("shadow_ai_runs").select("id,message_id,status,execution_state,model,prompt_version,telemetry_json,created_at").eq("prompt_version", REAL_SHADOW_AI_PROMPT_VERSION).order("created_at", { ascending: false }).limit(1000),
  ]);
  if (messageError || conversationError || runError) throw messageError || conversationError || runError;
  const model = env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL;
  const turns = buildRealShadowConversationTurns({ messages: messages || [], conversations: conversations || [], env, now });
  const eligible = turns.map((turn) => {
    const related = (runs || []).filter((run) => run.model === model && (turn.messageIds.includes(run.message_id) || run.telemetry_json?.turn_key === turn.turnKey));
    const latest = related[0] || null;
    const disposition = autoRealRunDisposition(latest);
    return { ...turn, disposition, runId: latest?.id || null, runState: latest?.execution_state || null };
  });
  return { turns: eligible, conversations: conversations || [], messages: messages || [], model, promptVersion: REAL_SHADOW_AI_PROMPT_VERSION, lookbackDays: days };
}

export async function startAutoRealTurn(admin, turn, conversation, env = process.env, inputMode = "auto_real_shadow") {
  assertAutoRealEnvironment(env, { requireBackfill: inputMode === "backfill_real_shadow" });
  if (turn.disposition !== "pending") return { status: turn.disposition, runId: turn.runId || null };
  return startShadowAiStateMachine(admin, { messageId: turn.anchorMessageId, envelope: realShadowTurnEnvelope(turn, conversation) }, runOptions(env, turn, inputMode));
}

export async function processNextAutoRealTurn(admin, { env = process.env, lookbackDays = AUTO_REAL_LOOKBACK_DAYS_MAX, inputMode = "auto_real_shadow" } = {}) {
  assertAutoRealEnvironment(env, { requireBackfill: inputMode === "backfill_real_shadow" });
  const loaded = await loadAutoRealTurns(admin, { lookbackDays, env });
  const awaiting = loaded.turns.find((turn) => turn.disposition === "block_running" && turn.runState === "awaiting_model_round");
  if (awaiting) return continueShadowAiStateMachine(admin, awaiting.runId, runOptions(env, awaiting, inputMode));
  const running = loaded.turns.find((turn) => turn.disposition === "block_running");
  if (running) return { status: "running", processed: [{ turnKey: running.turnKey, anchorMessageId: running.anchorMessageId, runId: running.runId, status: "running" }] };
  const pending = loaded.turns.find((turn) => turn.disposition === "pending");
  if (!pending) return { status: "idle", processed: [] };
  const conversation = loaded.conversations.find((item) => item.id === pending.conversationId);
  const result = await startAutoRealTurn(admin, pending, conversation, env, inputMode);
  return { status: result.status, processed: [{ turnKey: pending.turnKey, anchorMessageId: pending.anchorMessageId, runId: result.runId || null, status: result.status }] };
}

export function estimateAutoRealVolume(turns, { inputTokensPerRound = 5000, outputTokensPerRound = 500, probableRounds = 1.35 } = {}) {
  const pending = turns.filter((turn) => turn.disposition === "pending").length;
  const rounds = pending * probableRounds; const inputTokens = Math.ceil(rounds * inputTokensPerRound); const outputTokens = Math.ceil(rounds * outputTokensPerRound);
  return { pendingTurns: pending, probableRounds: rounds, inputTokens, outputTokens, estimatedCostUsd: (inputTokens + outputTokens * 5) / 1_000_000 };
}
