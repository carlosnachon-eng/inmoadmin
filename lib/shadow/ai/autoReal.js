import { PROD_PROJECT_REF } from "../../ejecutivo/workCenter.js";
import { DEFAULT_SHADOW_AI_MODEL } from "./anthropic.js";
import { buildRealShadowConversationTurns, realShadowTurnEnvelope } from "./conversationTurns.js";
import { REAL_SHADOW_AUTO_AI_PROMPT_VERSION, REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "./realPrompt.js";
import { continueShadowAiStateMachine, startShadowAiStateMachine } from "./stateMachine.js";

export const AUTO_REAL_MAX_TURNS_PER_INVOCATION = 1;
export const AUTO_REAL_LOOKBACK_DAYS_MAX = 5;
const DEV_REF = "hjfwjnejbcpmknvfpdcq";
const ref = (env) => String(env.NEXT_PUBLIC_SUPABASE_URL || "").match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i)?.[1] || null;

export function parseAutoRealCutoff(env = process.env) {
  const raw = String(env.SHADOW_AI_AUTO_REAL_NOT_BEFORE || "").trim();
  if (!raw) throw new Error("auto_real_cutoff_required");
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw) || new Date(parsed).toISOString().slice(0, 19) !== raw.slice(0, 19)) throw new Error("auto_real_cutoff_invalid");
  return { iso: new Date(parsed).toISOString(), timestamp: parsed };
}

export function filterAutoRealTurnsByCutoff(turns = [], env = process.env) {
  const cutoff = parseAutoRealCutoff(env);
  const before = [], eligible = [];
  for (const turn of turns) {
    const lastInboundAt = Date.parse(turn.lastInboundAt);
    if (!Number.isFinite(lastInboundAt) || lastInboundAt < cutoff.timestamp) before.push(turn);
    else eligible.push(turn);
  }
  return { cutoff, before, eligible };
}

export function assertAutoRealEnvironment(env = process.env, { mode = "auto" } = {}) {
  if (!['auto', 'backfill'].includes(mode)) throw new Error("auto_real_mode_invalid");
  if (mode === "auto" && env.SHADOW_AI_AUTO_REAL_ENABLED !== "true") throw new Error("auto_real_kill_switch_disabled");
  if (mode === "backfill" && env.SHADOW_AI_BACKFILL_REAL_ENABLED !== "true") throw new Error("auto_real_backfill_disabled");
  if (mode === "backfill" && env.SHADOW_AI_AUTO_REAL_ENABLED === "true") throw new Error("auto_real_must_be_disabled_during_backfill");
  if (env.SHADOW_OUTBOUND_ENABLED === "true" || env.SHADOW_AI_ALLOW_OPERATIONAL_EVENTS === "true") throw new Error("auto_real_safety_flags_blocked");
  if (env.SHADOW_AI_ENABLED !== "true" || env.SHADOW_AI_PRODUCTION_ENABLED !== "true" || env.SHADOW_AI_ALLOW_REAL_MESSAGES !== "true") throw new Error("auto_real_global_ai_flags_required");
  if (mode === "auto") parseAutoRealCutoff(env);
  const projectRef = ref(env);
  if (env.VERCEL_ENV === "production" && env.SUPABASE_ENVIRONMENT === "production" && projectRef === PROD_PROJECT_REF) return { mode: "production", projectRef };
  if (env.VERCEL_ENV === "preview" && env.SUPABASE_ENVIRONMENT === "dev" && projectRef === DEV_REF && env.SHADOW_AI_AUTO_REAL_DEV_TEST_ENABLED === "true") return { mode: "dev_test", projectRef };
  throw new Error("auto_real_environment_mismatch");
}

const runtimeEnv = (env) => ({ ...env, SHADOW_AI_ENABLED: "true", SHADOW_AI_PRODUCTION_ENABLED: "true", SHADOW_AI_ALLOW_REAL_MESSAGES: "true", SHADOW_AI_ALLOW_OPERATIONAL_EVENTS: "false", SHADOW_OUTBOUND_ENABLED: "false" });
const runOptions = (env, turn, inputMode) => ({
  env: runtimeEnv(env), promptVersion: REAL_SHADOW_AUTO_AI_PROMPT_VERSION, systemPrompt: REAL_SHADOW_AI_SYSTEM_PROMPT,
  toolGuide: REAL_SHADOW_AI_TOOL_GUIDE, inputMode, allowRetry: false,
  persistInputSnapshot: true,
  idempotencyIdentity: `turn:${turn.turnKey}`, turnMetadata: { turnKey: turn.turnKey, messageIds: turn.messageIds, humanResponseId: turn.humanResponseId, closedReason: turn.closedReason },
});

export function autoRealRunDisposition(run) {
  if (!run) return "pending";
  if (run.status === "completed") return "skip_completed";
  if (run.status === "running") return "block_running";
  if (["error", "timeout"].includes(run.status)) return "report_failed_no_retry";
  return "blocked_previous_status";
}

export function selectAutoRealRun(runs = [], promptVersion = REAL_SHADOW_AUTO_AI_PROMPT_VERSION) {
  return runs.find((run) => run.prompt_version === promptVersion)
    || runs.find((run) => run.status === "completed") || runs[0] || null;
}

export async function loadAutoRealTurns(admin, { lookbackDays = AUTO_REAL_LOOKBACK_DAYS_MAX, env = process.env, now = Date.now(), inputMode = "auto_real_shadow" } = {}) {
  const days = Math.max(1, Math.min(AUTO_REAL_LOOKBACK_DAYS_MAX, Number(lookbackDays || AUTO_REAL_LOOKBACK_DAYS_MAX)));
  const since = new Date(now - days * 86400000).toISOString();
  const [{ data: messages, error: messageError }, { data: conversations, error: conversationError }, { data: runs, error: runError }, { data: mediaInterpretations, error: mediaError }] = await Promise.all([
    admin.from("shadow_messages").select("id,conversation_id,direction,occurred_at,sanitized_text,attachment_metadata,provider_metadata,external_message_id").gte("occurred_at", since).order("occurred_at", { ascending: true }).limit(1000),
    admin.from("shadow_conversations").select("id,provider,channel,respond_contact_id"),
    admin.from("shadow_ai_runs").select("id,message_id,status,execution_state,current_round,model,prompt_version,telemetry_json,created_at").order("created_at", { ascending: false }).limit(1000),
    admin.from("shadow_media_interpretations").select("external_message_id,status,result_safe,interpreted_at").eq("status","completed").gte("interpreted_at",since).limit(1000),
  ]);
  if (messageError || conversationError || runError || mediaError) throw messageError || conversationError || runError || mediaError;
  const model = env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL;
  const turns = buildRealShadowConversationTurns({ messages: messages || [], conversations: conversations || [], mediaInterpretations:mediaInterpretations||[], env, now });
  const mapped = turns.map((turn) => {
    const related = (runs || []).filter((run) => run.model === model && (turn.messageIds.includes(run.message_id) || run.telemetry_json?.turn_key === turn.turnKey));
    const latest = selectAutoRealRun(related);
    const disposition = autoRealRunDisposition(latest);
    return { ...turn, disposition, runId: latest?.id || null, runState: latest?.execution_state || null, runCreatedAt: latest?.created_at || null, runInputMode: latest?.telemetry_json?.input_mode || null, currentRound: Number(latest?.current_round || 0) };
  });
  const autoMode = inputMode !== "backfill_real_shadow";
  const filtered = autoMode ? filterAutoRealTurnsByCutoff(mapped, env) : { cutoff: null, before: [], eligible: mapped };
  const lastAutomaticRun = [...filtered.eligible].filter((turn) => turn.runId && turn.runInputMode === "auto_real_shadow").sort((a, b) => Date.parse(b.runCreatedAt || 0) - Date.parse(a.runCreatedAt || 0))[0]?.runId || null;
  return {
    turns: filtered.eligible, conversations: conversations || [], messages: messages || [], model,
    promptVersion: REAL_SHADOW_AUTO_AI_PROMPT_VERSION, lookbackDays: days,
    observability: {
      cutoff: filtered.cutoff?.iso || null,
      turnsBeforeCutoffExcluded: filtered.before.length,
      turnsAfterCutoff: filtered.eligible.length,
      eligibleNewTurns: filtered.eligible.filter((turn) => turn.disposition === "pending").length,
      lastAutomaticRun,
    },
  };
}

export async function startAutoRealTurn(admin, turn, conversation, env = process.env, inputMode = "auto_real_shadow") {
  assertAutoRealEnvironment(env, { mode: inputMode === "backfill_real_shadow" ? "backfill" : "auto" });
  if (turn.disposition !== "pending") return { status: turn.disposition, runId: turn.runId || null };
  return startShadowAiStateMachine(admin, { messageId: turn.anchorMessageId, envelope: realShadowTurnEnvelope(turn, conversation, env) }, runOptions(env, turn, inputMode));
}

export async function processNextAutoRealTurn(admin, { env = process.env, lookbackDays = AUTO_REAL_LOOKBACK_DAYS_MAX, inputMode = "auto_real_shadow" } = {}) {
  assertAutoRealEnvironment(env, { mode: inputMode === "backfill_real_shadow" ? "backfill" : "auto" });
  const loaded = await loadAutoRealTurns(admin, { lookbackDays, env, inputMode });
  const awaiting = loaded.turns.find((turn) => turn.disposition === "block_running" && turn.runState === "awaiting_model_round");
  if (awaiting) return { ...(await continueShadowAiStateMachine(admin, awaiting.runId, runOptions(env, awaiting, inputMode))), observability: loaded.observability };
  const running = loaded.turns.find((turn) => turn.disposition === "block_running");
  if (running) return { status: "running", processed: [{ turnKey: running.turnKey, anchorMessageId: running.anchorMessageId, runId: running.runId, status: "running" }], observability: loaded.observability };
  const pending = loaded.turns.find((turn) => turn.disposition === "pending");
  if (!pending) return { status: "idle", processed: [], observability: loaded.observability };
  const conversation = loaded.conversations.find((item) => item.id === pending.conversationId);
  const result = await startAutoRealTurn(admin, pending, conversation, env, inputMode);
  return { status: result.status, processed: [{ turnKey: pending.turnKey, anchorMessageId: pending.anchorMessageId, runId: result.runId || null, status: result.status }], observability: { ...loaded.observability, lastAutomaticRun: result.runId || loaded.observability.lastAutomaticRun } };
}

export function estimateAutoRealVolume(turns, { inputTokensPerRound = 5000, outputTokensPerRound = 500, probableRounds = 1.35 } = {}) {
  const pending = turns.filter((turn) => turn.disposition === "pending").length;
  const rounds = pending * probableRounds; const inputTokens = Math.ceil(rounds * inputTokensPerRound); const outputTokens = Math.ceil(rounds * outputTokensPerRound);
  return { pendingTurns: pending, probableRounds: rounds, inputTokens, outputTokens, estimatedCostUsd: (inputTokens + outputTokens * 5) / 1_000_000 };
}
