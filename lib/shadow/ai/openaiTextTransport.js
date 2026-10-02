import { createHash } from "node:crypto";
import { requestOpenAiSession, openAiSessionId } from "../../agentsV2/openaiSessionTransport.js";
import { estimateAgentCostUsd, knownAgentUsage } from "../../agentsV2/agentUsage.js";
import { serializeVerifiedOpenAiBody } from "./finalModelPrivacy.js";
import { recordModelPrivacyReceipt } from "./modelPrivacyTelemetry.js";
import { buildReducedShadowDecisionSchema } from "./reducedOutputSchema.js";
import { shadowOpenAiModel } from "./openaiTextRuntime.js";

const opaque = value => value ? createHash("sha256").update(`openai-shadow:${value}`).digest("hex").slice(0, 24) : null;
const failure = (code, stage = "provider_response") => Object.assign(new Error(code), { code, outputStage: stage });
const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(failure("model_timeout", "timeout"));
  const abort = () => { clearTimeout(timer); reject(failure("model_timeout", "timeout")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  signal.addEventListener("abort", abort, { once: true });
});

// One fresh, non-autonomous session per local round. The state machine owns ALL
// tool execution. There is no session continuation / tool_result POST here.
export async function createOpenAiShadowTextResponse(messages, {
  env = process.env, fetchImpl = fetch, signal, timeoutMs = 40000, onReceipt = () => {}, onSession = () => {},
} = {}) {
  let stage = "pre_provider_failed", invoked = false, sessionId = null, terminal = false;
  let cancellation = "not_needed", sessionRef = null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, Math.max(1, Math.min(Number(timeoutMs) || 40000, 105000)));
  const receipt = () => stage === "serialized_body_verified" ? {
    final_payload_verified: true, serialized_body_verified: true, provider_invoked: invoked,
    output_mode: "openai_json_schema", privacy_stage: "final_model_privacy",
  } : { privacy_stage: "final_model_privacy", privacy_failure_code: stage, provider_invoked: false };
  const request = (path, options = {}) => requestOpenAiSession(path, { env, fetchImpl, signal: controller.signal, ...options });
  let usage = null, accreditedModel = null;
  try {
    const model = shadowOpenAiModel(env);
    if (!env.OPENAI_API_KEY) throw failure("shadow_openai_key_missing", "pre_provider");
    const body = {
      agent: { model, instructions: messages.find(m => m.role === "system")?.content || "",
        tools: [], multi_agent: { enabled: false }, text: { format: { type: "json_schema", schema: buildReducedShadowDecisionSchema() } } },
      environment: { type: "none" }, input: messages.filter(m => m.role === "user").map(m => m.content).join("\n"), stream: false,
    };
    stage = "final_payload_rejected";
    const serialized = serializeVerifiedOpenAiBody(body, messages, model, next => {
      stage = next === "final_payload_verified" ? "body_serialization_failed" : next === "body_serialized" ? "serialized_body_rejected" : "serialized_body_verified";
    });
    if (controller.signal.aborted) throw failure("model_timeout", "timeout");
    invoked = true; onReceipt(receipt());
    const session = await request("", { method: "POST", body: serialized });
    sessionId = openAiSessionId(session?.id);
    if (!sessionId) throw failure("provider_invalid_session_reference");
    sessionRef = opaque(sessionId); onSession({ session_ref: sessionRef });
    // Configuration acknowledgement is NOT a model-response accreditation.
    for (let poll = 0; poll < 200; poll++) {
      if (controller.signal.aborted) throw failure("model_timeout", "timeout");
      const current = await request(`/${sessionId}`);
      if (current.required_actions?.length) throw failure("unexpected_provider_tool_action");
      const turns = await request(`/${sessionId}/turns?order=asc&limit=100`);
      if (turns.has_more || !Array.isArray(turns.data) || turns.data.length > 1) throw failure("unexpected_provider_turn_count");
      const turn = turns.data[0];
      usage = knownAgentUsage(turn?.usage);
      // Agents turns have no model field. Accredit only the provider-returned
      // session agent linked to this completed turn, never the requested config.
      accreditedModel = turn?.status === "completed" && turn.agent_id && turn.agent_id === current.agent?.id
        && current.agent.model === model ? current.agent.model : null;
      if (["failed", "cancelled"].includes(turn?.status) || current.status === "failed") {
        terminal = true; throw failure("provider_turn_failed");
      }
      if (turn?.status === "completed") {
        terminal = true;
        const items = await request(`/${sessionId}/items?order=asc&limit=100`);
        if (items.has_more || !Array.isArray(items.data)) throw failure("provider_output_unavailable");
        const output = items.data.filter(item => item.type === "message" && item.role === "assistant");
        if (output.length !== 1) throw failure("provider_output_ambiguous");
        const parts = output[0].content;
        if (!Array.isArray(parts) || parts.some(p => p.type !== "output_text")) throw failure("provider_output_unavailable");
        const text = parts.map(p => p.text).join("");
        if (!text || Buffer.byteLength(text) > 65536) throw failure("provider_output_unavailable");
        const result = { text, id: opaque(turn.id), model: accreditedModel, usage: usage ? { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens } : null,
          openai: { session_ref: sessionRef, turn_ref: opaque(turn.id), model: accreditedModel, usage,
            model_provenance: accreditedModel ? "provider_session_agent_completed_turn" : null,
            estimated_cost_usd: accreditedModel && usage && usage.cachedInputTokens !== null ? estimateAgentCostUsd(accreditedModel, usage, env) : null,
            cancellation, provider_invoked: true } };
        return recordModelPrivacyReceipt(result, receipt());
      }
      await pause(250, controller.signal);
    }
    throw failure("model_timeout", "timeout");
  } catch (original) {
    if (sessionId && !terminal) {
      cancellation = "uncertain";
      const cancel = new AbortController(); const cancelTimer = setTimeout(() => cancel.abort(), 1500);
      try {
        // Same verified serialization boundary for the only other allowed POST.
        const body = serializeVerifiedOpenAiBody({ events: [{ type: "agent.session.input.cancel" }] }, messages, shadowOpenAiModel(env));
        await requestOpenAiSession(`/${sessionId}/events`, { env, fetchImpl, signal: cancel.signal, method: "POST", body });
        cancellation = "requested";
      } catch { /* Preserve uncertainty; never retry creation/cancellation. */ }
      finally { clearTimeout(cancelTimer); }
    }
    if (invoked && !sessionId) cancellation = "uncertain";
    const error = controller.signal.aborted ? failure("model_timeout", "timeout") : original;
    if (error.code === "model_timeout" || error.message === "model_timeout") error.timeoutStage = "model_timeout";
    error.openai = { session_ref: sessionRef, model: accreditedModel, usage, cancellation, provider_invoked: invoked };
    onReceipt(receipt());
    throw recordModelPrivacyReceipt(error, receipt());
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
