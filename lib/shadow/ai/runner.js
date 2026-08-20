import crypto from "node:crypto";
import { READ_ONLY_SHADOW_TOOLS, executeShadowReadOnlyTool } from "../context.js";
import { SHADOW_AI_LIMITS, shadowAiGuard } from "./guards.js";
import { createAnthropicShadowResponse, DEFAULT_SHADOW_AI_MODEL } from "./anthropic.js";
import { SHADOW_AI_PROMPT_VERSION, SHADOW_AI_SYSTEM_PROMPT } from "./prompt.js";
import { validateShadowAiDecision } from "./schema.js";

const unsafePatterns = /(?:ya (?:descont[eé]|devolv[ií]|cancel[eé]|entregu[eé]|cort[eé])|queda autorizado|hemos pagado|se realizar[aá] el pago)/i;
const privatePatterns = /(?:https?:\/\/|@|\+?52\s*\d|\b\d{10,18}\b)/i;
const sanitizeError = (error) => {
  if (!error?.providerError) return String(error?.message || "ai_error").replace(/[\r\n]/g, " ").slice(0, 180);
  const p = error.providerError;
  return [
    `s=${p.provider_status || ""}`, `t=${String(p.provider_error_type || "").slice(0, 32)}`,
    `c=${String(p.provider_error_code || "").slice(0, 24)}`, `f=${String(p.provider_error_field || "").slice(0, 36)}`,
    `r=${String(p.provider_request_id || "").slice(0, 48)}`, `m=${String(p.provider_error_message || "").slice(0, 40)}`,
  ].join(";").slice(0, 180);
};
const idempotencyKey = (messageId, model) => crypto.createHash("sha256").update(`${messageId}:${SHADOW_AI_PROMPT_VERSION}:${model}`).digest("hex");
const MAX_ATTEMPTS = 3;
const retryableStatus = (status) => ["error", "timeout"].includes(status);

function minimalContext(envelope, deterministic, toolResults) {
  return {
    message: envelope.sanitizedText,
    metadata: Object.fromEntries(Object.entries(envelope.providerMetadata || {}).filter(([key]) => ["area","service","propertyReference","propertyId","contractId","paymentId","serviceId","ticketId","keyId","ownerPaymentId","workCenterContextKey","syntheticScenario"].includes(key))),
    deterministic: { intent: deterministic?.intent, requiresHuman: deterministic?.requiresHuman, reasonCodes: deterministic?.reasonCodes || [] },
    tools: toolResults.map(({ name, result }) => ({ name, result })),
    availableTools: READ_ONLY_SHADOW_TOOLS,
  };
}

function requestedCalls(decision) {
  return (decision.proposedToolCalls || []).slice(0, SHADOW_AI_LIMITS.maxToolsPerRound).map((entry) => {
    const [name, ...rest] = String(entry).split(":"); return { name: name.trim(), query: rest.join(":").trim() };
  }).filter((call) => call.query);
}

export async function runShadowAi(admin, { messageId, envelope, deterministic }, options = {}) {
  const env = options.env || process.env; const guard = shadowAiGuard(envelope, env);
  if (!guard.allowed) return { status: guard.status };
  const model = env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL;
  const key = idempotencyKey(messageId, model);
  const { data: priorRuns, error: priorRunsError } = await admin.from("shadow_ai_runs")
    .select("id,status,attempt_number,retry_of_run_id,created_at")
    .eq("idempotency_key", key)
    .order("created_at", { ascending: false })
    .order("attempt_number", { ascending: false })
    .limit(MAX_ATTEMPTS + 1);
  if (priorRunsError) throw priorRunsError;
  const attempts = priorRuns || [];
  const latest = attempts[0] || null;
  if (latest?.status === "completed") return { status: "duplicate", runId: latest.id };
  if (latest?.status === "running") return { status: "running", runId: latest.id };
  if (latest && !retryableStatus(latest.status)) return { status: "blocked_previous_status", runId: latest.id };
  if (attempts.length >= MAX_ATTEMPTS) return { status: "retry_limit_reached", runId: latest?.id || null, attempts: attempts.length };
  if (latest) {
    const { data: inconsistentDecision, error: decisionLookupError } = await admin.from("shadow_ai_decisions")
      .select("id,ai_run_id")
      .eq("ai_run_id", latest.id)
      .limit(1)
      .maybeSingle();
    if (decisionLookupError) throw decisionLookupError;
    if (inconsistentDecision) return { status: "retry_inconsistent", runId: latest.id, decisionId: inconsistentDecision.id };
  }
  const startedAt = new Date().toISOString();
  const attemptNumber = attempts.length + 1;
  const { data: run, error: runError } = await admin.from("shadow_ai_runs").insert({
    message_id: messageId, status: "running", model, prompt_version: SHADOW_AI_PROMPT_VERSION,
    started_at: startedAt, idempotency_key: key, attempt_number: attemptNumber, retry_of_run_id: latest?.id || null,
  }).select("id").single();
  if (runError?.code === "23505") return { status: "running", runId: null };
  if (runError) throw runError;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Number(env.SHADOW_AI_TIMEOUT_MS || SHADOW_AI_LIMITS.timeoutMs));
  const tools = []; let decision; let usage = {};
  try {
    for (let round = 0; round < SHADOW_AI_LIMITS.maxToolRounds; round += 1) {
      const modelResult = await (options.modelCall || createAnthropicShadowResponse)([
        { role: "system", content: SHADOW_AI_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(minimalContext(envelope, deterministic, tools)) },
      ], { signal: controller.signal, env });
      usage = modelResult.usage || usage;
      decision = validateShadowAiDecision(JSON.parse(modelResult.text));
      const calls = requestedCalls(decision).filter(({ name }) => READ_ONLY_SHADOW_TOOLS.includes(name) && !tools.some((item) => item.name === name));
      if (!calls.length) break;
      for (const call of calls) {
        const began = Date.now();
        try { const result = await executeShadowReadOnlyTool(admin, call.name, { query: call.query }); tools.push({ name: call.name, args: { query: call.query }, result, ok: true, durationMs: Date.now() - began }); }
        catch { tools.push({ name: call.name, args: { query: call.query }, result: [], ok: false, durationMs: Date.now() - began }); }
      }
    }
    if (!decision) throw new Error("empty_model_output");
    if (unsafePatterns.test(decision.proposedResponse) || privatePatterns.test(decision.proposedResponse)) {
      decision.requiresHuman = true; decision.safetyFlags = [...new Set([...decision.safetyFlags, "unsafe_or_private_response_blocked"])]; decision.proposedResponse = "Necesito que una persona del equipo revise este caso antes de responder.";
    }
    const completedAt = new Date().toISOString(); const latencyMs = Date.parse(completedAt) - Date.parse(startedAt);
    const inputTokens = Number(usage.input_tokens || 0); const outputTokens = Number(usage.output_tokens || 0);
    const estimatedCostUsd = (inputTokens * 1.00 + outputTokens * 5.00) / 1_000_000;
    const { error: decisionError } = await admin.from("shadow_ai_decisions").insert({ ai_run_id: run.id, status: "completed", ...{
      intent: decision.intent, urgency: decision.urgency, proposed_action: decision.proposedAction, proposed_response: decision.proposedResponse,
      confidence: decision.confidence, requires_human: decision.requiresHuman, escalation_reason: decision.escalationReason,
      decision_json: decision, tool_summary: tools.map(({ name, args, result, ok, durationMs }) => ({ name, args, resultCount: result.length, ok, durationMs })),
    } });
    if (decisionError) throw decisionError;
    await admin.from("shadow_ai_runs").update({ status: "completed", completed_at: completedAt, latency_ms: latencyMs, input_tokens: inputTokens, output_tokens: outputTokens, estimated_cost_usd: estimatedCostUsd }).eq("id", run.id);
    return { status: "completed", runId: run.id, decision, tools, usage, latencyMs, estimatedCostUsd };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const latencyMs = Date.parse(completedAt) - Date.parse(startedAt);
    await admin.from("shadow_ai_runs").update({ status: error?.name === "AbortError" ? "timeout" : "error", completed_at: completedAt, latency_ms: latencyMs, error_sanitized: sanitizeError(error) }).eq("id", run.id);
    return { status: error?.name === "AbortError" ? "timeout" : "error", runId: run.id, error: sanitizeError(error), providerError: error?.providerError || null, latencyMs };
  } finally { clearTimeout(timer); }
}
