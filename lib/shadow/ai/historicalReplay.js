import { createHash } from "node:crypto";
import { buildRealShadowConversationTurns, isTurnQaFree, realShadowTurnEnvelope } from "./conversationTurns.js";
import { buildConversationAction, semanticConversationGuard } from "./conversationAction.js";
import { buildShadowOperationalResolution } from "./operationalResolution.js";
import { classifyExplicitShadowAiIntent, finalizeShadowAiDecision, minimalShadowAiContext, requestedShadowAiCalls, shadowAiDependencyError } from "./runner.js";
import { validateShadowAiDecision } from "./schema.js";
import { createAnthropicShadowResponse, DEFAULT_SHADOW_AI_MODEL } from "./anthropic.js";
import { REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "./realPrompt.js";
import { READ_ONLY_SHADOW_TOOLS, executeShadowReadOnlyTool, validateShadowToolArguments } from "../context.js";

export const HISTORICAL_REPLAY_RUNTIME = "administradora-ia-emporio-historical-replay-v1";
export const HISTORICAL_REPLAY_MAX_CASES = 30;
export const HISTORICAL_REPLAY_MAX_PER_DOMAIN = 10;
export const HISTORICAL_REPLAY_DOMAINS = Object.freeze(["maintenance", "payment", "administrative_pending"]);
export const HISTORICAL_REPLAY_RATINGS = Object.freeze(["correct", "acceptable_with_changes", "incorrect", "should_escalate", "not_evaluable"]);
export const HISTORICAL_REPLAY_REASONS = Object.freeze(["tone", "missing_information", "wrong_question", "invented_fact", "wrong_context", "financial_risk", "legal_risk", "other"]);

const clean = (value, max = 4000) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const opaque = (value) => createHash("sha256").update(String(value)).digest("hex");
const domainFor = (text) => {
  const intent = classifyExplicitShadowAiIntent(text);
  if (["mantenimiento", "llaves"].includes(intent)) return "maintenance";
  if (["pago_renta", "servicio", "propietario_liquidacion"].includes(intent)) return "payment";
  if (/\b(?:tr[aá]mite|documento|pendiente|seguimiento|estatus|contrato|administraci[oó]n)\b/i.test(text)) return "administrative_pending";
  return null;
};

export function historicalReplayCapabilities(env = process.env) {
  return {
    enabled: env.SHADOW_HISTORICAL_REPLAY_ENABLED === "true",
    anthropicEnabled: env.SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED === "true",
    outboundBlocked: env.SHADOW_ADMIN_OUTBOUND_ENABLED !== "true" && env.SHADOW_OUTBOUND_ENABLED !== "true",
  };
}

export function assertHistoricalReplayIsolation(env = process.env, { requireAnthropic = false } = {}) {
  const caps = historicalReplayCapabilities(env);
  if (!caps.enabled) throw new Error("historical_replay_disabled");
  if (!caps.outboundBlocked) throw new Error("historical_replay_outbound_fail_closed");
  if (requireAnthropic && !caps.anthropicEnabled) throw new Error("historical_replay_anthropic_disabled");
  return caps;
}

export function selectHistoricalReplayCohort({ messages = [], conversations = [], mediaInterpretations = [], env = process.env, now = Date.now(), selectedTurnKeys = null } = {}) {
  assertHistoricalReplayIsolation(env);
  const messagesById = new Map(messages.map((row) => [row.id, row]));
  const conversationsById = new Map(conversations.map((row) => [row.id, row]));
  const turns = buildRealShadowConversationTurns({ messages, conversations, mediaInterpretations, env, now });
  const allowedKeys = selectedTurnKeys ? new Set(selectedTurnKeys.map(String)) : null;
  if (allowedKeys?.size > HISTORICAL_REPLAY_MAX_CASES) throw new Error("historical_replay_cohort_limit");
  const counts = Object.fromEntries(HISTORICAL_REPLAY_DOMAINS.map((key) => [key, 0]));
  const cases = [];
  for (const turn of turns.slice().reverse()) {
    if (allowedKeys && !allowedKeys.has(turn.turnKey)) continue;
    if (!isTurnQaFree(turn, messagesById) || !["human_response", "settled", "inbound_gap"].includes(turn.closedReason)) continue;
    const domain = domainFor(turn.sanitizedText);
    if (!domain || counts[domain] >= HISTORICAL_REPLAY_MAX_PER_DOMAIN) continue;
    const conversation = conversationsById.get(turn.conversationId);
    if (!conversation || conversation.provider !== "respond_admin" || String(conversation.channel) !== "544519") continue;
    const historicalText = clean(turn.sanitizedText);
    const sufficient = historicalText.length >= 8;
    const human = turn.humanResponseId ? messagesById.get(turn.humanResponseId) : null;
    const envelope = realShadowTurnEnvelope(turn, conversation, env);
    cases.push({
      evaluationMode: "historical_replay", historicalTurnKey: turn.turnKey, evaluationRuntimeVersion: HISTORICAL_REPLAY_RUNTIME,
      caseRef: opaque(`${turn.turnKey}:${HISTORICAL_REPLAY_RUNTIME}`).slice(0, 16), domain,
      occurredAt: turn.lastInboundAt, closedReason: turn.closedReason, messageCount: turn.messageIds.length,
      turnSnapshot: { sanitizedText: historicalText, priorConversation: envelope.providerMetadata.priorConversation || [], attachmentContext: envelope.providerMetadata.attachmentContext || {}, messageIds: turn.messageIds.map(opaque), anchorRef: opaque(turn.anchorMessageId) },
      envelope, humanResponseSnapshot: human ? clean(human.sanitized_text, 1200) : null,
      humanResponseRef: human ? opaque(human.id) : null, sufficientHistoricalContext: sufficient,
      exclusionReason: sufficient ? null : "insufficient_historical_context",
      temporalGrounding: "current_state", identityGrounding: envelope.providerMetadata.respondContactId ? "current_canonical_mapping" : "unresolved",
    });
    counts[domain] += 1;
    if (cases.length === HISTORICAL_REPLAY_MAX_CASES) break;
  }
  if (allowedKeys && cases.some((item) => !allowedKeys.has(item.historicalTurnKey))) throw new Error("historical_replay_selection_mismatch");
  return { cases, counts, selected: cases.length, maxCases: HISTORICAL_REPLAY_MAX_CASES, groundTruthExcludedFromInput: true };
}

const safeTool = (call, result, ok, error = null, durationMs = 0) => ({ name: call.name, args: call.args, reason: clean(call.reason, 120), result: Array.isArray(result) ? result.slice(0, 25) : [], ok, error, durationMs });
const costUsd = (input, output) => Number(((Number(input) * 0.000001) + (Number(output) * 0.000005)).toFixed(6));

export async function executeHistoricalReplayCase(admin, replayCase, { env = process.env, modelCall = createAnthropicShadowResponse, executeTool = executeShadowReadOnlyTool, now = () => Date.now() } = {}) {
  assertHistoricalReplayIsolation(env, { requireAnthropic: true });
  if (replayCase?.evaluationMode !== "historical_replay" || !replayCase?.sufficientHistoricalContext) throw new Error("insufficient_historical_context");
  const started = now(); const tools = []; let decision; let inputTokens = 0; let outputTokens = 0; const requestIds = [];
  for (let round = 0; round < 2; round += 1) {
    const deterministic = { intent: classifyExplicitShadowAiIntent(replayCase.envelope.sanitizedText), requiresHuman: false, reasonCodes: [] };
    const result = await modelCall([
      { role: "system", content: `${REAL_SHADOW_AI_SYSTEM_PROMPT}\n\n${REAL_SHADOW_AI_TOOL_GUIDE}` },
      { role: "user", content: JSON.stringify(minimalShadowAiContext(replayCase.envelope, deterministic, tools, round)) },
    ], { env });
    requestIds.push(clean(result.id, 80)); inputTokens += Number(result.usage?.input_tokens || 0); outputTokens += Number(result.usage?.output_tokens || 0);
    decision = validateShadowAiDecision(JSON.parse(result.text));
    const calls = requestedShadowAiCalls(decision).filter((call) => !tools.some((tool) => tool.name === call.name && tool.ok));
    if (!calls.length) break;
    for (const requested of calls) {
      const began = now(); let item;
      try {
        if (!READ_ONLY_SHADOW_TOOLS.includes(requested.name)) throw new Error("tool_not_allowlisted");
        const call = { ...requested, args: validateShadowToolArguments(requested.name, requested.args) };
        const dependency = shadowAiDependencyError(call, replayCase.envelope, tools); if (dependency) throw new Error(dependency);
        item = safeTool(call, await executeTool(admin, call.name, call.args), true, null, now() - began);
      } catch (error) { item = safeTool(requested, [], false, clean(error.message, 80), now() - began); }
      tools.push(item);
    }
  }
  const finalDecision = finalizeShadowAiDecision(decision, replayCase.envelope, tools);
  const resolution = buildShadowOperationalResolution({ decision: finalDecision, envelope: replayCase.envelope, tools });
  const action = buildConversationAction({ resolution, decision: finalDecision, turn: { settled: true, humanResponseId: null }, now: started });
  return {
    evaluationMode: "historical_replay", evaluationRuntimeVersion: HISTORICAL_REPLAY_RUNTIME,
    temporalGrounding: replayCase.temporalGrounding, identityGrounding: replayCase.identityGrounding,
    operationalResolution: resolution, conversationAction: action, tools: tools.map(({ name, ok, error, durationMs, result }) => ({ name, ok, error, durationMs, resultCount: result.length })),
    evidence: resolution.evidence || [], providerRequestRefs: requestIds.map(opaque), inputTokens, outputTokens,
    estimatedCostUsd: costUsd(inputTokens, outputTokens), latencyMs: now() - started,
    messageSafe: semanticConversationGuard(action.proposed_message).allowed,
    humanResponseSnapshot: replayCase.humanResponseSnapshot,
  };
}

export function historicalReplayMetrics(cases = []) {
  const completed = cases.filter((row) => row.status === "completed");
  const rated = completed.filter((row) => row.human_rating);
  const count = (key, value) => rated.filter((row) => row[key] === value).length;
  return {
    total: cases.length, completed: completed.length, correct: count("human_rating", "correct"), acceptable: count("human_rating", "acceptable_with_changes"),
    incorrect: count("human_rating", "incorrect"), shouldEscalate: count("human_rating", "should_escalate"), notEvaluable: count("human_rating", "not_evaluable"),
    safeMessageRate: completed.length ? completed.filter((row) => row.message_safe).length / completed.length : 0,
    actionAppropriatenessRate: rated.length ? rated.filter((row) => ["correct", "acceptable_with_changes"].includes(row.human_rating)).length / rated.length : 0,
    wouldResolveWithoutHumanRate: completed.length ? completed.filter((row) => row.would_resolve_without_human).length / completed.length : 0,
    firstOutboundCandidates: completed.filter((row) => ["ask_missing_information", "request_document"].includes(row.conversation_action)).length,
  };
}
