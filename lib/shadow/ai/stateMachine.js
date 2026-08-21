import { READ_ONLY_SHADOW_TOOLS, executeShadowReadOnlyTool, validateShadowToolArguments } from "../context.js";
import { classifyShadowMessage } from "../coordinator.js";
import { SHADOW_AI_LIMITS, shadowAiGuard } from "./guards.js";
import { createAnthropicShadowResponse, DEFAULT_SHADOW_AI_MODEL } from "./anthropic.js";
import { SHADOW_AI_PROMPT_VERSION, SHADOW_AI_SYSTEM_PROMPT, SHADOW_AI_TOOL_GUIDE } from "./prompt.js";
import { SHADOW_AI_OUTPUT_SCHEMA_VERSION, validateShadowAiDecision } from "./schema.js";
import { buildEvidenceLedger } from "./grounding.js";
import { combinePolicyAndModelTools, deriveRequiredTools } from "./toolPolicy.js";
import { buildResolvedOperationalContext } from "./operationalContext.js";
import {
  finalizeShadowAiDecision, minimalShadowAiContext,
  requestedShadowAiCalls, sanitizeShadowAiError, shadowAiDependencyError,
  shadowAiIdempotencyKey, shadowAiRuntimeClock, withShadowAiStageTimeout,
} from "./runner.js";

export const SHADOW_AI_RUN_STATES = Object.freeze([
  "created", "model_round_running", "awaiting_tool_execution", "awaiting_model_round",
  "completed", "blocked", "error", "timeout",
]);
const MAX_ATTEMPTS = 3;
const costUsd = (input, output) => (Number(input || 0) * 1 + Number(output || 0) * 5) / 1_000_000;
const toolKey = (round, name, args) => `${round}:${name}:${JSON.stringify(args)}`;
const safeTool = ({ name, args, reason, source, result, ok, error, durationMs, round }) => ({ name, args, reason, source, result, ok, error: error || null, durationMs, round });
const envelopeFromMessage = (message) => ({
  provider: message.provider,
  direction: message.direction,
  sanitizedText: message.sanitized_text,
  providerMetadata: message.provider_metadata || {},
  externalMessageId: message.external_message_id,
  occurredAt: message.occurred_at,
});

export function continuationDisposition(run) {
  if (!run) return "run_not_found";
  if (run.execution_state === "awaiting_model_round") return "claim";
  if (run.execution_state === "model_round_running" || run.execution_state === "awaiting_tool_execution") return "already_running";
  if (["completed", "blocked", "error", "timeout"].includes(run.execution_state)) return `blocked_${run.execution_state}`;
  return "invalid_state";
}

export function nextRoundPlan(run, calls, existingTools) {
  const round = Number(run.current_round || 0) + 1;
  const seen = new Set((existingTools || []).map((tool) => tool.idempotencyKey));
  const uniqueCalls = [];
  for (const call of calls) {
    const candidate = { ...call, idempotencyKey: toolKey(round, call.name, call.args) };
    if (seen.has(candidate.idempotencyKey)) continue;
    seen.add(candidate.idempotencyKey); uniqueCalls.push(candidate);
  }
  return { round, uniqueCalls, canContinue: round < Number(run.max_rounds || SHADOW_AI_LIMITS.maxToolRounds) };
}

async function claimRun(admin, runId, expectedState) {
  const now = new Date().toISOString();
  const { data, error } = await admin.from("shadow_ai_runs")
    .update({ execution_state: "model_round_running", state_updated_at: now })
    .eq("id", runId).eq("execution_state", expectedState)
    .select("*").maybeSingle();
  if (error) throw error;
  return data;
}

async function persistFailure(admin, run, error, telemetry, clock, startedMs) {
  const rawTimeoutStage = error?.timeoutStage || (error?.name === "AbortError" ? "anthropic_request_timeout" : null);
  const timeoutStage = rawTimeoutStage === "global_run_timeout" ? "request_budget_exhausted" : rawTimeoutStage;
  const state = timeoutStage ? "timeout" : "error"; const endedMs = clock.now();
  const nextTelemetry = { ...telemetry, timeout_stage: timeoutStage, total_active_duration_ms: Number(telemetry.total_active_duration_ms || 0) + (endedMs - startedMs) };
  await admin.from("shadow_ai_runs").update({ status: state, execution_state: state, completed_at: new Date(endedMs).toISOString(), state_updated_at: new Date(endedMs).toISOString(), error_sanitized: timeoutStage || sanitizeShadowAiError(error), telemetry_json: nextTelemetry }).eq("id", run.id).eq("execution_state", "model_round_running");
  return { status: state, state, runId: run.id, timeoutStage, error: timeoutStage || sanitizeShadowAiError(error), telemetry: nextTelemetry };
}

export async function executeShadowAiStateStep(admin, runId, expectedState, options = {}) {
  const env = options.env || process.env; const clock = shadowAiRuntimeClock(options); const requestStartedMs = clock.now();
  const run = await claimRun(admin, runId, expectedState);
  if (!run) return { status: "already_running", state: "model_round_running", runId };
  const { data: message, error: messageError } = await admin.from("shadow_messages").select("id,provider,direction,sanitized_text,provider_metadata,external_message_id,occurred_at").eq("id", run.message_id).maybeSingle();
  if (messageError) throw messageError;
  const storedOperationalContext = run.round_state_json?.resolvedOperationalContext || {};
  const resolvedOperationalContext = buildResolvedOperationalContext({ metadata: message?.provider_metadata || {}, persistedContext: storedOperationalContext, toolResults: run.tool_results_json || [] });
  const envelope = { ...envelopeFromMessage(message || {}), providerMetadata: { ...(message?.provider_metadata || {}), ...resolvedOperationalContext } }; const guard = shadowAiGuard(envelope, env);
  if (!guard.allowed) {
    await admin.from("shadow_ai_runs").update({ execution_state: expectedState, state_updated_at: new Date().toISOString() }).eq("id", run.id).eq("execution_state", "model_round_running");
    return { status: guard.status, state: expectedState, runId };
  }
  const deterministic = classifyShadowMessage(envelope); const previousTools = Array.isArray(run.tool_results_json) ? run.tool_results_json : [];
  const telemetry = run.telemetry_json && typeof run.telemetry_json === "object" ? structuredClone(run.telemetry_json) : {};
  telemetry.http_steps ||= []; telemetry.anthropic_requests ||= []; telemetry.tools ||= []; telemetry.rounds ||= [];
  const round = Number(run.current_round || 0) + 1; const controller = new AbortController(); const anthropicStartedMs = clock.now();
  try {
    const modelResult = await withShadowAiStageTimeout(() => (options.modelCall || createAnthropicShadowResponse)([
      { role: "system", content: `${SHADOW_AI_SYSTEM_PROMPT}\n\n${SHADOW_AI_TOOL_GUIDE}` },
      { role: "user", content: JSON.stringify(minimalShadowAiContext(envelope, deterministic, previousTools, round - 1)) },
    ], { signal: controller.signal, env }), { stage: "anthropic_request_timeout", stageTimeoutMs: Number(env.SHADOW_AI_ANTHROPIC_TIMEOUT_MS || SHADOW_AI_LIMITS.anthropicRequestTimeoutMs), globalDeadlineMs: requestStartedMs + Number(env.SHADOW_AI_GLOBAL_TIMEOUT_MS || SHADOW_AI_LIMITS.globalRunTimeoutMs), clock, controller });
    const anthropicDurationMs = clock.now() - anthropicStartedMs;
    const decision = validateShadowAiDecision(JSON.parse(modelResult.text));
    const policyContext = buildResolvedOperationalContext({ metadata: envelope.providerMetadata, persistedContext: resolvedOperationalContext, resolvedEntities: decision.resolvedEntities, toolResults: previousTools });
    const policy = deriveRequiredTools({ intent: decision.intent, secondaryIntents: decision.secondaryIntents, message: envelope.sanitizedText, resolvedOperationalContext: policyContext, toolResults: previousTools });
    const combinedCalls = combinePolicyAndModelTools(policy.requiredNowTools, requestedShadowAiCalls(decision))
      .filter((call) => !previousTools.some((tool) => tool.ok && tool.name === call.name));
    const plan = nextRoundPlan(run, combinedCalls, previousTools);
    const tools = [...previousTools];
    for (const call of plan.uniqueCalls.slice(0, SHADOW_AI_LIMITS.maxToolsPerRound)) {
      const began = clock.now(); let item;
      try {
        if (!READ_ONLY_SHADOW_TOOLS.includes(call.name)) throw new Error("tool_not_allowlisted");
        const args = validateShadowToolArguments(call.name, call.args);
        const dependency = shadowAiDependencyError({ ...call, args }, envelope, previousTools); if (dependency) throw new Error(dependency);
        const result = await withShadowAiStageTimeout(() => (options.executeTool || executeShadowReadOnlyTool)(admin, call.name, args), { stage: "tool_timeout", stageTimeoutMs: Number(env.SHADOW_AI_TOOL_TIMEOUT_MS || SHADOW_AI_LIMITS.toolTimeoutMs), globalDeadlineMs: requestStartedMs + Number(env.SHADOW_AI_GLOBAL_TIMEOUT_MS || SHADOW_AI_LIMITS.globalRunTimeoutMs), clock, controller: null });
        item = safeTool({ ...call, args, result, ok: true, durationMs: clock.now() - began, round });
      } catch (error) {
        item = safeTool({ ...call, result: [], ok: false, error: error?.timeoutStage || String(error?.message || "invalid_tool_call").slice(0, 80), durationMs: clock.now() - began, round });
        if (error?.timeoutStage) throw error;
      }
      item.idempotencyKey = call.idempotencyKey; tools.push(item);
      telemetry.tools.push({ round_number: round, name: item.name, source: item.source, tool_duration_ms: item.durationMs, succeeded: item.ok, error: item.error });
    }
    const usageInput = Number(run.input_tokens || 0) + Number(modelResult.usage?.input_tokens || 0);
    const usageOutput = Number(run.output_tokens || 0) + Number(modelResult.usage?.output_tokens || 0);
    const roundRecord = { round_number: round, request_id: modelResult.id || null, status: "completed", anthropic_duration_ms: anthropicDurationMs, output_state: "complete", policy_required_tools: policy.requiredNowTools, expected_after_clarification_tools: policy.expectedAfterClarificationTools, proposed_tool_calls: plan.uniqueCalls.map(({ name, args, reason, source }) => ({ name, args, reason, source })) };
    telemetry.anthropic_requests.push({ request_number: telemetry.anthropic_requests.length + 1, ...roundRecord }); telemetry.rounds.push(roundRecord);
    telemetry.http_steps.push({ step_number: telemetry.http_steps.length + 1, round_number: round, status: plan.uniqueCalls.length ? "awaiting_model_round" : "completed", duration_ms: clock.now() - requestStartedMs });
    telemetry.total_active_duration_ms = Number(telemetry.total_active_duration_ms || 0) + (clock.now() - requestStartedMs);
    const roundState = run.round_state_json && typeof run.round_state_json === "object" ? structuredClone(run.round_state_json) : { rounds: [] };
    roundState.resolvedOperationalContext = policyContext;
    roundState.rounds ||= []; roundState.rounds.push({ roundNumber: round, decision, policyRequiredTools: policy.requiredNowTools, expectedAfterClarificationTools: policy.expectedAfterClarificationTools, proposedToolCalls: roundRecord.proposed_tool_calls, providerRequestId: modelResult.id || null });
    const evidenceLedger = buildEvidenceLedger(tools);
    if (plan.uniqueCalls.length && plan.canContinue) {
      const now = new Date(clock.now()).toISOString();
      await admin.from("shadow_ai_runs").update({ execution_state: "awaiting_model_round", current_round: round, state_updated_at: now, round_state_json: roundState, evidence_ledger: evidenceLedger, tool_results_json: tools, telemetry_json: telemetry, input_tokens: usageInput, output_tokens: usageOutput, estimated_cost_usd: costUsd(usageInput, usageOutput), latency_ms: telemetry.total_active_duration_ms }).eq("id", run.id).eq("execution_state", "model_round_running");
      return { status: "awaiting_model_round", state: "awaiting_model_round", runId: run.id, currentRound: round, maxRounds: run.max_rounds, tools, evidenceLedger, telemetry };
    }
    let finalDecision = finalizeShadowAiDecision(decision, envelope, tools);
    if (plan.uniqueCalls.length && !plan.canContinue) {
      finalDecision = { ...finalDecision, responseBlocked: true, requiresHuman: true, groundingStatus: "blocked", groundingReason: "max_rounds_reached", proposedResponse: "Respuesta bloqueada; requiere revisión humana." };
    }
    const finalState = finalDecision.responseBlocked ? "blocked" : "completed"; const now = new Date(clock.now()).toISOString();
    const { error: decisionError } = await admin.from("shadow_ai_decisions").insert({ ai_run_id: run.id, status: "completed", intent: finalDecision.intent, urgency: finalDecision.urgency, proposed_action: finalDecision.proposedAction, proposed_response: finalDecision.proposedResponse, confidence: finalDecision.confidence, requires_human: finalDecision.requiresHuman, escalation_reason: finalDecision.escalationReason, decision_json: finalDecision, tool_summary: tools.map(({ name, args, reason, source, result, ok, error, durationMs, round: toolRound }) => ({ name, args, reason, source, resultCount: result.length, ok, error, durationMs, round: toolRound })) });
    if (decisionError) throw decisionError;
    await admin.from("shadow_ai_runs").update({ status: "completed", execution_state: finalState, current_round: round, completed_at: now, state_updated_at: now, round_state_json: roundState, evidence_ledger: evidenceLedger, tool_results_json: tools, grounding_state_json: { status: finalDecision.groundingStatus, reason: finalDecision.groundingReason, responseBlocked: Boolean(finalDecision.responseBlocked) }, telemetry_json: telemetry, input_tokens: usageInput, output_tokens: usageOutput, estimated_cost_usd: costUsd(usageInput, usageOutput), latency_ms: telemetry.total_active_duration_ms }).eq("id", run.id).eq("execution_state", "model_round_running");
    return { status: finalState, state: finalState, runId: run.id, currentRound: round, decision: finalDecision, tools, evidenceLedger, telemetry };
  } catch (error) {
    telemetry.anthropic_requests.push({ request_number: telemetry.anthropic_requests.length + 1, round_number: round, request_id: error?.providerError?.provider_request_id || null, status: "failed", anthropic_duration_ms: clock.now() - anthropicStartedMs, output_state: "none", error: error?.timeoutStage || "anthropic_request_error" });
    return persistFailure(admin, run, error, telemetry, clock, requestStartedMs);
  }
}

export async function startShadowAiStateMachine(admin, { messageId, envelope }, options = {}) {
  const env = options.env || process.env; const guard = shadowAiGuard(envelope, env); if (!guard.allowed) return { status: guard.status };
  const model = env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL; const campaignId = options.campaignId || null; const key = shadowAiIdempotencyKey(messageId, model, campaignId);
  const { data: attempts, error } = await admin.from("shadow_ai_runs").select("id,status,execution_state,attempt_number,retry_of_run_id,created_at").eq("idempotency_key", key).order("created_at", { ascending: false }).order("attempt_number", { ascending: false }).limit(MAX_ATTEMPTS + 1);
  if (error) throw error; const latest = attempts?.[0] || null;
  if (latest?.status === "completed") return { status: "duplicate", runId: latest.id };
  if (latest?.status === "running") return { status: latest.execution_state === "awaiting_model_round" ? "awaiting_model_round" : "running", runId: latest.id };
  if (latest && !["error", "timeout"].includes(latest.status)) return { status: "blocked_previous_status", runId: latest.id };
  if ((attempts || []).length >= MAX_ATTEMPTS) return { status: "retry_limit_reached", runId: latest?.id || null };
  if (latest) {
    const { data: inconsistent, error: decisionError } = await admin.from("shadow_ai_decisions").select("id").eq("ai_run_id", latest.id).limit(1).maybeSingle(); if (decisionError) throw decisionError;
    if (inconsistent) return { status: "retry_inconsistent", runId: latest.id, decisionId: inconsistent.id };
  }
  const now = new Date().toISOString(); const attempt = (attempts || []).length + 1;
  const resolvedOperationalContext = options.resolvedOperationalContext || buildResolvedOperationalContext({ metadata: envelope.providerMetadata || {} });
  const { data: run, error: insertError } = await admin.from("shadow_ai_runs").insert({ message_id: messageId, status: "running", execution_state: "created", current_round: 0, max_rounds: SHADOW_AI_LIMITS.maxToolRounds, model, prompt_version: SHADOW_AI_PROMPT_VERSION, schema_version: SHADOW_AI_OUTPUT_SCHEMA_VERSION, campaign_id: campaignId, started_at: now, state_updated_at: now, idempotency_key: key, attempt_number: attempt, retry_of_run_id: latest?.id || null, round_state_json: { resolvedOperationalContext, rounds: [] }, telemetry_json: { schema_version: SHADOW_AI_OUTPUT_SCHEMA_VERSION, prompt_version: SHADOW_AI_PROMPT_VERSION, campaign_id: campaignId, retry_authorization: latest ? (options.retryAuthorization || null) : null, context_identifier_keys: Object.keys(resolvedOperationalContext), http_steps: [], anthropic_requests: [], tools: [], rounds: [] } }).select("id").single();
  if (insertError?.code === "23505") return { status: "running", runId: null };
  if (insertError) throw insertError;
  return executeShadowAiStateStep(admin, run.id, "created", options);
}

export async function continueShadowAiStateMachine(admin, runId, options = {}) {
  const { data: run, error } = await admin.from("shadow_ai_runs").select("id,status,execution_state,message_id,current_round,max_rounds").eq("id", runId).maybeSingle(); if (error) throw error;
  const disposition = continuationDisposition(run); if (disposition !== "claim") return { status: disposition, state: run?.execution_state || null, runId };
  return executeShadowAiStateStep(admin, runId, "awaiting_model_round", options);
}
