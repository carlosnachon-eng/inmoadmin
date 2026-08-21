import { DEFAULT_SHADOW_AI_MODEL } from "./anthropic.js";
import { SHADOW_AI_PROMPT_VERSION } from "./prompt.js";
import { SHADOW_AI_QA_DATASET, SHADOW_AI_QA_REGRESSION_FIXTURES, evaluateShadowAiQa } from "./qaDataset.js";

export const SHADOW_QA_MAX_MICRO_BATCH = 1;
export const SHADOW_QA_REQUEST_BUDGET_MS = 118000;
export const SHADOW_QA_RESERVE_MS = 8000;
export const SHADOW_QA_MIN_RUN_BUDGET_MS = 15000;
const fixtureSet = new Set([...SHADOW_AI_QA_DATASET, ...SHADOW_AI_QA_REGRESSION_FIXTURES].map((item) => item.id));

export function validateExplicitFixtureIds(value) {
  if (!Array.isArray(value) || !value.length || value.length > SHADOW_QA_MAX_MICRO_BATCH) throw new Error("invalid_fixture_batch");
  const ids = [...new Set(value.map((item) => String(item || "").trim()))];
  if (ids.length !== value.length || ids.some((id) => !fixtureSet.has(id))) throw new Error("invalid_fixture_ids");
  return ids;
}

export function executionDisposition(status, { retryFailed = false, attemptNumber = 0, hasDecision = false } = {}) {
  if (status === "completed") return retryFailed ? "reject_retry_completed" : "skip_completed";
  if (status === "running") return retryFailed ? "reject_retry_running" : "block_running";
  if (["error", "timeout"].includes(status)) {
    if (!retryFailed) return "report_failed_no_retry";
    if (Number(attemptNumber || 0) >= 3) return "retry_limit_reached";
    if (hasDecision) return "retry_inconsistent";
    return "execute_retry";
  }
  if (retryFailed) return "reject_retry_without_failed_run";
  return "execute";
}

export function remainingRunBudget(startedAtMs, nowMs) {
  return SHADOW_QA_REQUEST_BUDGET_MS - (nowMs - startedAtMs) - SHADOW_QA_RESERVE_MS;
}

export function aggregatePersistedShadowQa({ messages = [], runs = [], decisions = [] }, { model = DEFAULT_SHADOW_AI_MODEL, promptVersion = SHADOW_AI_PROMPT_VERSION } = {}) {
  const messagesByFixture = new Map(messages.map((message) => [message.provider_metadata?.syntheticScenario, message]));
  const decisionsByRun = new Map(decisions.map((decision) => [decision.ai_run_id, decision]));
  const results = []; const missingFixtures = [];
  for (const scenario of SHADOW_AI_QA_DATASET) {
    const message = messagesByFixture.get(scenario.id);
    const candidates = runs.filter((run) => run.message_id === message?.id && run.model === model && run.prompt_version === promptVersion)
      .sort((a,b) => new Date(b.created_at || b.started_at || 0) - new Date(a.created_at || a.started_at || 0));
    const run = candidates[0];
    if (!run) { missingFixtures.push(scenario.id); continue; }
    const stored = decisionsByRun.get(run.id); const toolSummary = stored?.tool_summary || [];
    results.push({ fixtureId: scenario.id, status: run.status, runId: run.id, decision: stored?.decision_json || null,
      tools: toolSummary.map((tool) => ({ ...tool, result: Array.from({ length: Number(tool.resultCount || 0) }) })),
      latencyMs: run.latency_ms, rounds: Array.isArray(run.telemetry_json?.rounds) ? run.telemetry_json.rounds.length : 0,
      usage: { input_tokens: run.input_tokens, output_tokens: run.output_tokens }, estimatedCostUsd: run.estimated_cost_usd });
  }
  return { results, missingFixtures, completed: results.filter((item) => item.status === "completed").length,
    metrics: evaluateShadowAiQa(SHADOW_AI_QA_DATASET, results) };
}
