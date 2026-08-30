import { READ_ONLY_SHADOW_TOOLS, executeShadowReadOnlyTool, validateShadowToolArguments } from "../context.js";
import { classifyShadowMessage } from "../coordinator.js";
import { SHADOW_AI_LIMITS, shadowAiGuard } from "./guards.js";
import { classifyAnthropicFailure, createAnthropicShadowRepairResponse, createAnthropicShadowResponse, DEFAULT_SHADOW_AI_MODEL, shadowAiOutputMode } from "./anthropic.js";
import { SHADOW_AI_PROMPT_VERSION, SHADOW_AI_SYSTEM_PROMPT, SHADOW_AI_TOOL_GUIDE } from "./prompt.js";
import { SHADOW_AI_OUTPUT_SCHEMA_VERSION } from "./schema.js";
import { buildEvidenceLedger } from "./grounding.js";
import { combinePolicyAndModelTools, deriveRequiredTools } from "./toolPolicy.js";
import { buildResolvedOperationalContext } from "./operationalContext.js";
import { finalizeOperationalP3Decision, operationalEventToP3Input } from "./operationalEventAdapter.js";
import { REAL_SHADOW_CONTEXT_MAX_CHARS, REAL_SHADOW_CONTEXT_MAX_MESSAGES } from "./conversationTurns.js";
import { buildShadowOperationalResolution, shadowOperationalMetrics } from "./operationalResolution.js";
import { persistConversationAction } from "./conversationAction.js";
import { classifyInteractionDirection } from "./interactionDirection.js";
import { maybeExecuteAdministrativeWorkR1 } from "./administrativeWorkR1.js";
import { validateWithSingleRepair } from "./textJsonOutput.js";
import {
  finalizeShadowAiDecision, minimalShadowAiContext,
  requestedShadowAiCalls, sanitizeShadowAiError, shadowAiDependencyError,
  durableRunDeadline, shadowAiIdempotencyKey, shadowAiRuntimeClock, withShadowAiStageTimeout,
} from "./runner.js";

export const SHADOW_AI_RUN_STATES = Object.freeze([
  "created", "model_round_running", "awaiting_tool_execution", "awaiting_model_round",
  "completed", "blocked", "error", "timeout",
]);
const MAX_ATTEMPTS = 3;
const costUsd = (input, output) => (Number(input || 0) * 1 + Number(output || 0) * 5) / 1_000_000;
const toolKey = (round, name, args) => `${round}:${name}:${JSON.stringify(args)}`;
const AUTO_REAL_INPUT_MODES = ["auto_real_shadow", "auto_real_explicit_retry"];
const isAutoRealInputMode = (input_mode) => input_mode === "auto_real_shadow" || AUTO_REAL_INPUT_MODES.includes(input_mode);
const safeTool = ({ name, args, reason, source, result, ok, error, durationMs, round }) => ({ name, args, reason, source, result, ok, error: error || null, durationMs, round });
const envelopeFromMessage = (message) => ({
  provider: message.provider,
  direction: message.direction,
  sanitizedText: message.sanitized_text,
  providerMetadata: {
    ...(message.provider_metadata || {}),
    attachmentContext: {
      present: Array.isArray(message.attachment_metadata) && message.attachment_metadata.length > 0,
      interpreted: false,
      items: (message.attachment_metadata || []).slice(0, 10).map((item) => ({ type: String(item?.type || "file"), mimeType: item?.mimeType ? String(item.mimeType) : null })),
    },
  },
  externalMessageId: message.external_message_id,
  occurredAt: message.occurred_at,
});

export function createShadowAiInputSnapshot(envelope) {
  const prior = Array.isArray(envelope?.providerMetadata?.priorConversation)
    ? envelope.providerMetadata.priorConversation.slice(-REAL_SHADOW_CONTEXT_MAX_MESSAGES)
    : [];
  let priorChars = 0;
  const priorConversation = [];
  for (const item of prior) {
    if (!["inbound", "outbound_human"].includes(item?.direction)) continue;
    const sanitizedText = String(item?.sanitizedText || "");
    if (!sanitizedText || priorChars + sanitizedText.length > REAL_SHADOW_CONTEXT_MAX_CHARS) continue;
    priorConversation.push({ direction: item.direction, sanitizedText });
    priorChars += sanitizedText.length;
  }
  const turn = envelope?.providerMetadata?.conversationTurn || {};
  return {
    provider: String(envelope?.provider || ""), direction: String(envelope?.direction || ""),
    sanitizedText: String(envelope?.sanitizedText || ""), occurredAt: envelope?.occurredAt || null,
    externalMessageId: String(envelope?.externalMessageId || ""),
    providerMetadata: {
      channelId: String(envelope?.providerMetadata?.channelId || ""),
      respondContactId: String(envelope?.providerMetadata?.respondContactId || ""), priorConversation,
      contactRole: String(envelope?.providerMetadata?.contactRole || ""),
      authorRole: String(envelope?.providerMetadata?.authorRole || ""),
      turnAuthorRole: String(envelope?.providerMetadata?.turnAuthorRole || ""),
      attachmentContext: {
        present: envelope?.providerMetadata?.attachmentContext?.present === true,
        interpreted: envelope?.providerMetadata?.attachmentContext?.interpreted === true,
        items: Array.isArray(envelope?.providerMetadata?.attachmentContext?.items)
          ? envelope.providerMetadata.attachmentContext.items.slice(0, 10).map((item) => ({
            type: String(item?.type || "file"), mimeType: item?.mimeType ? String(item.mimeType) : null,
            ...(item?.interpretation?.interpretationStatus==="completed"?{interpretation:{
              interpretationStatus:"completed",category:String(item.interpretation.category||""),summary:String(item.interpretation.summary||"").slice(0,240),
              extractedFields:item.interpretation.extractedFields&&typeof item.interpretation.extractedFields==="object"?structuredClone(item.interpretation.extractedFields):{},
              confidence:Number(item.interpretation.confidence||0),requiresHumanReview:item.interpretation.requiresHumanReview===true,reviewReason:item.interpretation.reviewReason?String(item.interpretation.reviewReason).slice(0,160):null,
            }}:{}),
          }))
          : [],
      },
      conversationTurn: {
        turnKey: String(turn.turnKey || ""),
        messageIds: Array.isArray(turn.messageIds) ? turn.messageIds.map(String) : [],
        messageCount: Number(turn.messageCount || 0),
      },
    },
  };
}

export function inputEnvelopeForShadowAiRun(run, message, operationalInput, messageConversation) {
  const persisted = run?.input_kind !== "operational_event" && run?.round_state_json?.inputSnapshot;
  const inputEnvelope = operationalInput?.envelope || (persisted ? structuredClone(persisted) : envelopeFromMessage(message || {}));
  if (messageConversation) {
    inputEnvelope.provider = messageConversation.provider;
    inputEnvelope.providerMetadata = { ...(inputEnvelope.providerMetadata || {}), channelId: messageConversation.channel };
  }
  return inputEnvelope;
}

export function continuationDisposition(run) {
  if (!run) return "run_not_found";
  if (run.execution_state === "awaiting_model_round") return "claim";
  if (run.execution_state === "model_round_running" || run.execution_state === "awaiting_tool_execution") return "already_running";
  if (["completed", "blocked", "error", "timeout"].includes(run.execution_state)) return `blocked_${run.execution_state}`;
  return "invalid_state";
}

export function nextRoundPlan(run, calls, existingTools) {
  const round = Number(run.current_round || 0) + 1; let modelAttempt = null;
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
  const providerUsage = error?.providerResult?.usage || null;
  const inputTokens = providerUsage ? Number(run.input_tokens || 0) + Number(providerUsage.input_tokens || 0) : Number(run.input_tokens || 0);
  const outputTokens = providerUsage ? Number(run.output_tokens || 0) + Number(providerUsage.output_tokens || 0) : Number(run.output_tokens || 0);
  await admin.from("shadow_ai_runs").update({ status: state, execution_state: state, completed_at: new Date(endedMs).toISOString(), state_updated_at: new Date(endedMs).toISOString(), error_sanitized: timeoutStage || sanitizeShadowAiError(error), telemetry_json: nextTelemetry, input_tokens: inputTokens, output_tokens: outputTokens, estimated_cost_usd: costUsd(inputTokens, outputTokens), latency_ms: nextTelemetry.total_active_duration_ms }).eq("id", run.id).eq("execution_state", "model_round_running");
  return { status: state, state, runId: run.id, timeoutStage, error: timeoutStage || sanitizeShadowAiError(error), telemetry: nextTelemetry };
}

const retryableNoResponse = new Set(["connection_timeout", "headers_first_byte_timeout", "body_response_timeout", "connection_error"]);
export async function executeAnthropicAttemptPolicy({ call, clock, deadlineMs, attemptTimeoutMs, minimumRetryBudgetMs, priorRetryCount = 0, round, telemetry, persistAttempt = async () => {} }) {
  let retryCount = priorRetryCount;
  while (true) {
    const attemptNumber = telemetry.anthropic_requests.length + 1;
    const startedMs = clock.now(); let phase = "headers"; const controller = new AbortController();
    try {
      const result = await withShadowAiStageTimeout(
        () => call({ signal: controller.signal, onPhase: (next) => { phase = next === "body" ? "body" : phase; } }),
        { stage: "anthropic_request_timeout", stageTimeoutMs: attemptTimeoutMs, globalDeadlineMs: deadlineMs, clock, controller },
      );
      const endedMs = clock.now();
      const record = { attempt_number: attemptNumber, round_number: round, started_at: new Date(startedMs).toISOString(), ended_at: new Date(endedMs).toISOString(), status: "received", timeout_class: null, latency_ms: endedMs - startedMs, request_id: result?.id || null, usage: { input_tokens: Number(result?.usage?.input_tokens || 0), output_tokens: Number(result?.usage?.output_tokens || 0) }, estimated_cost_usd: costUsd(result?.usage?.input_tokens, result?.usage?.output_tokens), remaining_deadline_ms: Math.max(0, deadlineMs - endedMs), output_state: "received_pending_validation" };
      telemetry.anthropic_requests.push(record); await persistAttempt(telemetry);
      return { result, record, retryCount };
    } catch (error) {
      const endedMs = clock.now();
      const timeoutClass = error?.timeoutStage === "global_run_timeout" ? "local_deadline_exceeded" : error?.timeoutStage ? (phase === "body" ? "body_response_timeout" : "headers_first_byte_timeout") : classifyAnthropicFailure(error, phase);
      const record = { attempt_number: attemptNumber, round_number: round, started_at: new Date(startedMs).toISOString(), ended_at: new Date(endedMs).toISOString(), status: "failed", timeout_class: timeoutClass, latency_ms: endedMs - startedMs, request_id: error?.providerError?.provider_request_id || null, usage: null, estimated_cost_usd: null, remaining_deadline_ms: Math.max(0, deadlineMs - endedMs), output_state: "none", error: timeoutClass };
      telemetry.anthropic_requests.push(record); await persistAttempt(telemetry);
      const enoughBudget = deadlineMs - endedMs >= minimumRetryBudgetMs;
      if (!retryableNoResponse.has(timeoutClass) || retryCount >= SHADOW_AI_LIMITS.maxAnthropicRetriesPerRun || !enoughBudget) {
        error.timeoutClass = timeoutClass;
        if (timeoutClass === "local_deadline_exceeded" || (retryableNoResponse.has(timeoutClass) && !enoughBudget)) error.timeoutStage = "global_run_timeout";
        throw error;
      }
      retryCount += 1;
    }
  }
}

export async function executeShadowAiStateStep(admin, runId, expectedState, options = {}) {
  const env = options.env || process.env; const clock = shadowAiRuntimeClock(options); const requestStartedMs = clock.now();
  const run = await claimRun(admin, runId, expectedState);
  if (!run) return { status: "already_running", state: "model_round_running", runId };
  const { data: message, error: messageError } = run.message_id
    ? await admin.from("shadow_messages").select("id,conversation_id,provider,direction,sanitized_text,attachment_metadata,provider_metadata,external_message_id,occurred_at").eq("id", run.message_id).maybeSingle()
    : { data: null, error: null };
  if (messageError) throw messageError;
  const { data: operationalEvent, error: operationalError } = run.operational_event_id
    ? await admin.from("shadow_operational_events").select("id,source,kind,event_type,payload_safe,occurred_at").eq("id", run.operational_event_id).maybeSingle()
    : { data: null, error: null };
  if (operationalError) throw operationalError;
  if (!message && !operationalEvent) throw new Error("shadow_ai_input_not_found");
  const { data: messageConversation, error: conversationError } = message?.conversation_id
    ? await admin.from("shadow_conversations").select("provider,channel").eq("id", message.conversation_id).maybeSingle()
    : { data: null, error: null };
  if (conversationError) throw conversationError;
  const operationalInput = operationalEvent ? operationalEventToP3Input(operationalEvent) : null;
  const storedOperationalContext = run.round_state_json?.resolvedOperationalContext || {};
  const inputEnvelope = inputEnvelopeForShadowAiRun(run, message, operationalInput, messageConversation);
  const resolvedOperationalContext = buildResolvedOperationalContext({ metadata: inputEnvelope.providerMetadata || {}, persistedContext: storedOperationalContext, toolResults: run.tool_results_json || [] });
  const envelope = { ...inputEnvelope, providerMetadata: { ...(inputEnvelope.providerMetadata || {}), ...resolvedOperationalContext } }; const guard = shadowAiGuard(envelope, env);
  if (!guard.allowed) {
    await admin.from("shadow_ai_runs").update({ execution_state: expectedState, state_updated_at: new Date().toISOString() }).eq("id", run.id).eq("execution_state", "model_round_running");
    return { status: guard.status, state: expectedState, runId };
  }
  const deterministic = { ...classifyShadowMessage(envelope), interactionDirection: classifyInteractionDirection({ envelope }) }; const previousTools = Array.isArray(run.tool_results_json) ? run.tool_results_json : [];
  const telemetry = run.telemetry_json && typeof run.telemetry_json === "object" ? structuredClone(run.telemetry_json) : {};
  telemetry.http_steps ||= []; telemetry.anthropic_requests ||= []; telemetry.tools ||= []; telemetry.rounds ||= [];
  const round = Number(run.current_round || 0) + 1; let modelAttempt = null;
  try {
    const deadlineMs = durableRunDeadline(run);
    const promptVersion = options.promptVersion || run.prompt_version || SHADOW_AI_PROMPT_VERSION;
    if (promptVersion !== run.prompt_version) throw new Error("prompt_identity_mismatch");
    const systemPrompt = options.systemPrompt || SHADOW_AI_SYSTEM_PROMPT;
    const toolGuide = options.toolGuide || SHADOW_AI_TOOL_GUIDE;
    const messages = [
      { role: "system", content: `${systemPrompt}\n\n${toolGuide}` },
      { role: "user", content: JSON.stringify(minimalShadowAiContext(envelope, deterministic, previousTools, round - 1)) },
    ];
    const outputMode = options.outputMode || shadowAiOutputMode(env);
    const attempt = await executeAnthropicAttemptPolicy({
      call: ({ signal, onPhase }) => (options.modelCall || createAnthropicShadowResponse)(messages, { signal, onPhase, env, outputMode }),
      clock, deadlineMs, round, telemetry,
      attemptTimeoutMs: Number(env.SHADOW_AI_ANTHROPIC_ATTEMPT_TIMEOUT_MS || SHADOW_AI_LIMITS.autoRealAnthropicAttemptTimeoutMs),
      minimumRetryBudgetMs: Number(env.SHADOW_AI_MINIMUM_RETRY_BUDGET_MS || SHADOW_AI_LIMITS.minimumAnthropicRetryBudgetMs),
      priorRetryCount: Number(telemetry.provider_retry_count || 0),
      persistAttempt: async (next) => { await admin.from("shadow_ai_runs").update({ telemetry_json: next, state_updated_at: new Date(clock.now()).toISOString() }).eq("id", run.id).eq("execution_state", "model_round_running"); },
    });
    modelAttempt = attempt;
    telemetry.provider_retry_count = attempt.retryCount;
    const modelResult = attempt.result; let anthropicDurationMs = attempt.record.latency_ms; let validation;
    try {
      validation = await validateWithSingleRepair(modelResult.text, {
        repair: outputMode === "text_json_local" ? async (invalidText) => {
          const remaining = deadlineMs - clock.now();
          if (remaining < Number(env.SHADOW_AI_MINIMUM_REPAIR_BUDGET_MS || SHADOW_AI_LIMITS.minimumAnthropicRetryBudgetMs)) {
            const error = new Error("insufficient_repair_budget"); error.timeoutStage = "global_run_timeout"; throw error;
          }
          const repairAttempt = await executeAnthropicAttemptPolicy({
            call: ({ signal, onPhase }) => (options.repairModelCall || createAnthropicShadowRepairResponse)(invalidText, { signal, onPhase, env }),
            clock, deadlineMs, round, telemetry,
            attemptTimeoutMs: Number(env.SHADOW_AI_ANTHROPIC_ATTEMPT_TIMEOUT_MS || SHADOW_AI_LIMITS.autoRealAnthropicAttemptTimeoutMs),
            minimumRetryBudgetMs: Number(env.SHADOW_AI_MINIMUM_RETRY_BUDGET_MS || SHADOW_AI_LIMITS.minimumAnthropicRetryBudgetMs),
            priorRetryCount: SHADOW_AI_LIMITS.maxAnthropicRetriesPerRun,
            persistAttempt: async (next) => { await admin.from("shadow_ai_runs").update({ telemetry_json: next, state_updated_at: new Date(clock.now()).toISOString() }).eq("id", run.id).eq("execution_state", "model_round_running"); },
          });
          repairAttempt.record.repair_attempt = true;
          return repairAttempt.result;
        } : null,
      });
    } catch (validationError) {
      const repairResult = validationError.repairResult || null;
      validationError.providerResult = { id: repairResult?.id || modelResult.id || null, usage: repairResult?.usage || modelResult.usage || null, durationMs: anthropicDurationMs };
      Object.assign(attempt.record, validationError.outputTelemetry || { parse_success: false, schema_success: false, repair_attempted: false, repair_success: false, invalid_output: true });
      throw validationError;
    }
    const decision = validation.decision; const repairResult = validation.repairResult || null;
    Object.assign(attempt.record, validation.telemetry, { output_mode: outputMode });
    if (repairResult) anthropicDurationMs += Number(telemetry.anthropic_requests.at(-1)?.latency_ms || 0);
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
        const result = await withShadowAiStageTimeout(() => (options.executeTool || executeShadowReadOnlyTool)(admin, call.name, args), { stage: "tool_timeout", stageTimeoutMs: Number(env.SHADOW_AI_TOOL_TIMEOUT_MS || SHADOW_AI_LIMITS.toolTimeoutMs), globalDeadlineMs: deadlineMs, clock, controller: null });
        item = safeTool({ ...call, args, result, ok: true, durationMs: clock.now() - began, round });
      } catch (error) {
        item = safeTool({ ...call, result: [], ok: false, error: error?.timeoutStage || String(error?.message || "invalid_tool_call").slice(0, 80), durationMs: clock.now() - began, round });
        if (error?.timeoutStage) throw error;
      }
      item.idempotencyKey = call.idempotencyKey; tools.push(item);
      telemetry.tools.push({ round_number: round, name: item.name, source: item.source, tool_duration_ms: item.durationMs, succeeded: item.ok, error: item.error });
    }
    const usageInput = Number(run.input_tokens || 0) + Number(modelResult.usage?.input_tokens || 0) + Number(repairResult?.usage?.input_tokens || 0);
    const usageOutput = Number(run.output_tokens || 0) + Number(modelResult.usage?.output_tokens || 0) + Number(repairResult?.usage?.output_tokens || 0);
    const roundRecord = { round_number: round, request_id: modelResult.id || null, status: "completed", anthropic_duration_ms: anthropicDurationMs, output_state: "complete", policy_required_tools: policy.requiredNowTools, expected_after_clarification_tools: policy.expectedAfterClarificationTools, proposed_tool_calls: plan.uniqueCalls.map(({ name, args, reason, source }) => ({ name, args, reason, source })) };
    Object.assign(attempt.record, roundRecord, { attempt_number: attempt.record.attempt_number, latency_ms: attempt.record.latency_ms }); telemetry.rounds.push(roundRecord);
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
    if (operationalInput) finalDecision = finalizeOperationalP3Decision(finalDecision, operationalInput);
    if (!operationalInput && (isAutoRealInputMode(options.inputMode) || isAutoRealInputMode(run.telemetry_json?.input_mode))) {
      const operationalResolution = buildShadowOperationalResolution({ decision: finalDecision, envelope, tools });
      finalDecision = { ...finalDecision, operational_resolution: operationalResolution };
      telemetry.operational_resolution = shadowOperationalMetrics(operationalResolution);
    }
    if (plan.uniqueCalls.length && !plan.canContinue) {
      finalDecision = { ...finalDecision, responseBlocked: true, requiresHuman: true, groundingStatus: "blocked", groundingReason: "max_rounds_reached", proposedResponse: "Respuesta bloqueada; requiere revisión humana." };
    }
    const finalState = finalDecision.responseBlocked ? "blocked" : "completed"; const now = new Date(clock.now()).toISOString();
    const { error: decisionError } = await admin.from("shadow_ai_decisions").insert({ ai_run_id: run.id, status: "completed", intent: finalDecision.intent, urgency: finalDecision.urgency, proposed_action: finalDecision.proposedAction, proposed_response: finalDecision.proposedResponse, confidence: finalDecision.confidence, requires_human: finalDecision.requiresHuman, escalation_reason: finalDecision.escalationReason, decision_json: finalDecision, tool_summary: tools.map(({ name, args, reason, source, result, ok, error, durationMs, round: toolRound }) => ({ name, args, reason, source, resultCount: result.length, ok, error, durationMs, round: toolRound })) });
    if (decisionError) throw decisionError;
    if (finalDecision.operational_resolution && !operationalInput) {
      try {
        const actionResult = await persistConversationAction(admin, { run, message, resolution: finalDecision.operational_resolution, decision: finalDecision, telemetry, env, now: clock.now() });
        telemetry.conversation_action = { status: actionResult.status, action_id: actionResult.actionId || null };
      } catch {
        telemetry.conversation_action = { status: "generation_error", action_id: null };
      }
    }
    if (finalDecision.operational_resolution && !operationalInput && (isAutoRealInputMode(options.inputMode) || isAutoRealInputMode(run.telemetry_json?.input_mode))) {
      try {
        const r1Result = await maybeExecuteAdministrativeWorkR1({
          admin, run, message, envelope, resolution: finalDecision.operational_resolution,
          context: policyContext, humanResponseId: run.telemetry_json?.human_response_id || null, env,
        });
        telemetry.administrative_work_r1 = r1Result;
      } catch (r1Error) {
        telemetry.administrative_work_r1 = { status: "blocked", reason: String(r1Error?.message || "r1_execution_error").slice(0, 80), action: null };
      }
    }
    await admin.from("shadow_ai_runs").update({ status: "completed", execution_state: finalState, current_round: round, completed_at: now, state_updated_at: now, round_state_json: roundState, evidence_ledger: evidenceLedger, tool_results_json: tools, grounding_state_json: { status: finalDecision.groundingStatus, reason: finalDecision.groundingReason, responseBlocked: Boolean(finalDecision.responseBlocked) }, telemetry_json: telemetry, input_tokens: usageInput, output_tokens: usageOutput, estimated_cost_usd: costUsd(usageInput, usageOutput), latency_ms: telemetry.total_active_duration_ms }).eq("id", run.id).eq("execution_state", "model_round_running");
    return { status: finalState, state: finalState, runId: run.id, currentRound: round, decision: finalDecision, tools, evidenceLedger, telemetry };
  } catch (error) {
    const receivedInvalidOutput = Boolean(error?.providerResult);
    if (receivedInvalidOutput && telemetry.anthropic_requests.at(-1)?.status === "received") Object.assign(telemetry.anthropic_requests.at(-1), {
      status: "failed", output_state: "received_invalid_structured_output", error_stage: error.outputStage,
      diagnostic_code: error.diagnosticCode, error: "invalid_structured_output",
    }); else if (!modelAttempt && !telemetry.anthropic_requests.at(-1)?.timeout_class) telemetry.anthropic_requests.push({
      request_number: telemetry.anthropic_requests.length + 1, round_number: round,
      request_id: receivedInvalidOutput ? error.providerResult.id : error?.providerError?.provider_request_id || null,
      status: "failed",
      anthropic_duration_ms: receivedInvalidOutput ? error.providerResult.durationMs : clock.now() - requestStartedMs,
      output_state: receivedInvalidOutput ? "received_invalid_structured_output" : "none",
      error_stage: receivedInvalidOutput ? error.outputStage : (error?.providerError ? "provider_transport" : (error?.timeoutStage ? "timeout" : "anthropic_request")),
      diagnostic_code: receivedInvalidOutput ? error.diagnosticCode : null,
      usage: receivedInvalidOutput ? {
        input_tokens: Number(error.providerResult.usage?.input_tokens || 0),
        output_tokens: Number(error.providerResult.usage?.output_tokens || 0),
      } : null,
      error: error?.timeoutClass || error?.timeoutStage || (receivedInvalidOutput ? "invalid_structured_output" : "anthropic_request_error"),
    });
    return persistFailure(admin, run, error, telemetry, clock, requestStartedMs);
  }
}

export async function startShadowAiStateMachine(admin, { messageId, envelope }, options = {}) {
  const env = options.env || process.env; const guard = shadowAiGuard(envelope, env); if (!guard.allowed) return { status: guard.status };
  const model = env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL; const campaignId = options.campaignId || null; const promptVersion = options.promptVersion || SHADOW_AI_PROMPT_VERSION; const key = shadowAiIdempotencyKey(options.idempotencyIdentity || messageId, model, campaignId, promptVersion);
  const { data: attempts, error } = await admin.from("shadow_ai_runs").select("id,status,execution_state,attempt_number,retry_of_run_id,created_at").eq("idempotency_key", key).order("created_at", { ascending: false }).order("attempt_number", { ascending: false }).limit(MAX_ATTEMPTS + 1);
  if (error) throw error; const latest = attempts?.[0] || null;
  if (latest?.status === "completed") return { status: "duplicate", runId: latest.id };
  if (latest?.status === "running") return { status: latest.execution_state === "awaiting_model_round" ? "awaiting_model_round" : "running", runId: latest.id };
  if (latest && !["error", "timeout"].includes(latest.status)) return { status: "blocked_previous_status", runId: latest.id };
  if (latest && options.allowRetry !== true && options.retryAuthorization !== "explicit_user_authorized") return { status: "failed_no_retry", runId: latest.id };
  if ((attempts || []).length >= MAX_ATTEMPTS) return { status: "retry_limit_reached", runId: latest?.id || null };
  if (latest) {
    const { data: inconsistent, error: decisionError } = await admin.from("shadow_ai_decisions").select("id").eq("ai_run_id", latest.id).limit(1).maybeSingle(); if (decisionError) throw decisionError;
    if (inconsistent) return { status: "retry_inconsistent", runId: latest.id, decisionId: inconsistent.id };
  }
  const startedMs = (options.clock || { now: () => Date.now() }).now(); const now = new Date(startedMs).toISOString(); const deadlineAt = new Date(startedMs + Number(env.SHADOW_AI_DURABLE_DEADLINE_MS || SHADOW_AI_LIMITS.autoRealDurableDeadlineMs)).toISOString(); const attempt = (attempts || []).length + 1;
  const resolvedOperationalContext = options.resolvedOperationalContext || buildResolvedOperationalContext({ metadata: envelope.providerMetadata || {} });
  const inputSnapshot = options.persistInputSnapshot === true ? createShadowAiInputSnapshot(envelope) : null;
  const { data: run, error: insertError } = await admin.from("shadow_ai_runs").insert({ message_id: messageId, status: "running", execution_state: "created", current_round: 0, max_rounds: SHADOW_AI_LIMITS.maxToolRounds, model, prompt_version: promptVersion, schema_version: SHADOW_AI_OUTPUT_SCHEMA_VERSION, campaign_id: campaignId, started_at: now, deadline_at: deadlineAt, state_updated_at: now, idempotency_key: key, attempt_number: attempt, retry_of_run_id: latest?.id || null, ...(options.explicitRetryMetadata || {}), round_state_json: { resolvedOperationalContext, ...(inputSnapshot ? { inputSnapshot } : {}), rounds: [] }, telemetry_json: { schema_version: SHADOW_AI_OUTPUT_SCHEMA_VERSION, prompt_version: promptVersion, campaign_id: campaignId, input_mode: options.inputMode || "default", deadline_at: deadlineAt, media_settlement: options.turnMetadata?.mediaSettlement || null, retry_authorization: latest ? (options.retryAuthorization || null) : null, turn_key: options.turnMetadata?.turnKey || null, turn_message_ids: options.turnMetadata?.messageIds || [], human_response_id: options.turnMetadata?.humanResponseId || null, turn_closed_reason: options.turnMetadata?.closedReason || null, prior_context_message_count: inputSnapshot?.providerMetadata?.priorConversation?.length || 0, prior_context_chars: inputSnapshot?.providerMetadata?.priorConversation?.reduce((sum, item) => sum + item.sanitizedText.length, 0) || 0, context_identifier_keys: Object.keys(resolvedOperationalContext), http_steps: [], anthropic_requests: [], tools: [], rounds: [] } }).select("id").single();
  if (insertError?.code === "23505") return { status: "running", runId: null };
  if (insertError) throw insertError;
  if (options.beforeExecuteRun) {
    try { await options.beforeExecuteRun({ runId: run.id, messageId, model, promptVersion }); }
    catch (authorizationError) {
      const ended = new Date().toISOString();
      await admin.from("shadow_ai_runs").update({ status: "error", execution_state: "error", completed_at: ended, state_updated_at: ended, error_sanitized: "manual_authorization_not_consumable" }).eq("id", run.id).eq("execution_state", "created");
      return { status: "authorization_not_consumable", runId: run.id };
    }
  }
  return executeShadowAiStateStep(admin, run.id, "created", options);
}

export async function startOperationalShadowAiStateMachine(admin, operationalEvent, options = {}) {
  const input = operationalEventToP3Input(operationalEvent);
  const env = options.env || process.env; const guard = shadowAiGuard(input.envelope, env); if (!guard.allowed) return { status: guard.status };
  const model = env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL;
  const key = shadowAiIdempotencyKey(`operational:${input.inputId}`, model);
  const { data: prior, error } = await admin.from("shadow_ai_runs").select("id,status,execution_state").eq("idempotency_key", key).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (prior?.status === "completed") return { status: "duplicate", runId: prior.id };
  if (prior?.status === "running") return { status: prior.execution_state === "awaiting_model_round" ? "awaiting_model_round" : "running", runId: prior.id };
  if (prior) return { status: "blocked_previous_status", runId: prior.id };
  const startedMs = (options.clock || { now: () => Date.now() }).now(); const now = new Date(startedMs).toISOString(); const deadlineAt = new Date(startedMs + Number(env.SHADOW_AI_DURABLE_DEADLINE_MS || SHADOW_AI_LIMITS.autoRealDurableDeadlineMs)).toISOString();
  const resolvedOperationalContext = buildResolvedOperationalContext({ metadata: input.envelope.providerMetadata, persistedContext: input.operationalContext });
  const { data: run, error: insertError } = await admin.from("shadow_ai_runs").insert({
    message_id: null, operational_event_id: input.inputId, input_kind: "operational_event",
    status: "running", execution_state: "created", current_round: 0, max_rounds: SHADOW_AI_LIMITS.maxToolRounds,
    model, prompt_version: SHADOW_AI_PROMPT_VERSION, schema_version: SHADOW_AI_OUTPUT_SCHEMA_VERSION,
    started_at: now, deadline_at: deadlineAt, state_updated_at: now, idempotency_key: key, attempt_number: 1,
    round_state_json: { resolvedOperationalContext, rounds: [] },
    telemetry_json: { input_kind: "operational_event", operational_event_id: input.inputId, deadline_at: deadlineAt, schema_version: SHADOW_AI_OUTPUT_SCHEMA_VERSION, prompt_version: SHADOW_AI_PROMPT_VERSION, http_steps: [], anthropic_requests: [], tools: [], rounds: [] },
  }).select("id").single();
  if (insertError?.code === "23505") return { status: "running", runId: null };
  if (insertError) throw insertError;
  return executeShadowAiStateStep(admin, run.id, "created", options);
}

export async function continueShadowAiStateMachine(admin, runId, options = {}) {
  const { data: run, error } = await admin.from("shadow_ai_runs").select("id,status,execution_state,message_id,operational_event_id,current_round,max_rounds,prompt_version,model,campaign_id,deadline_at").eq("id", runId).maybeSingle(); if (error) throw error;
  const disposition = continuationDisposition(run); if (disposition !== "claim") return { status: disposition, state: run?.execution_state || null, runId };
  return executeShadowAiStateStep(admin, runId, "awaiting_model_round", options);
}
