import { anthropicShadowAiDecisionJsonSchema, shadowAiDecisionJsonSchema } from "./schema.js";
import { serializeVerifiedAnthropicBody } from "./finalModelPrivacy.js";
import { recordModelPrivacyReceipt } from "./modelPrivacyTelemetry.js";
import { buildReducedAnthropicDecisionSchema } from "./reducedOutputSchema.js";
import { assertHistoricalReplaySchemaContext } from "./historicalReplaySchemaContext.js";

export const DEFAULT_SHADOW_AI_MODEL = "claude-haiku-4-5-20251001";

const clean = (value, max) => String(value || "").replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").replace(/(?:sk-ant-|Bearer\s+)[A-Za-z0-9._-]+/gi, "[redacted]").slice(0, max) || null;
const fieldFromMessage = (message) => clean(String(message || "").match(/(?:at |field |path |in )[`'\"]?([a-zA-Z0-9_.\[\]-]+)/i)?.[1], 80);

export class AnthropicProviderError extends Error {
  constructor(details) {
    super(`model_http_${details.provider_status}`);
    this.name = "AnthropicProviderError";
    this.providerError = details;
  }
}

const transportCode = (error) => String(error?.cause?.code || error?.code || "").toUpperCase();
export function classifyAnthropicFailure(error, phase = "headers") {
  if (error?.code === "pre_model_sanitization_blocked") return "pre_model_sanitization_blocked";
  if (error?.providerError) {
    const status = Number(error.providerError.provider_status || 0);
    if (status === 429) return "provider_rate_limited";
    if (status >= 500) return "provider_5xx";
    return "provider_http_error";
  }
  const code = transportCode(error);
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ENETUNREACH") return "connection_timeout";
  if (code === "UND_ERR_HEADERS_TIMEOUT") return "headers_first_byte_timeout";
  if (code === "UND_ERR_BODY_TIMEOUT") return "body_response_timeout";
  if (error?.name === "AbortError") return phase === "body" ? "body_response_timeout" : "headers_first_byte_timeout";
  return "connection_error";
}

export function sanitizeAnthropicError(response, body) {
  const message = clean(body?.error?.message, 300);
  return {
    provider_status: Number(response?.status || 0) || null,
    provider_error_type: clean(body?.error?.type, 80),
    provider_error_code: clean(body?.error?.code || body?.type, 80),
    provider_error_field: clean(body?.error?.param || body?.error?.field, 80) || fieldFromMessage(message),
    provider_request_id: clean(body?.request_id || response?.headers?.get?.("request-id"), 120),
    provider_error_message: message,
  };
}

export const SHADOW_AI_OUTPUT_MODES = Object.freeze(["anthropic_json_schema", "text_json_local"]);
export const shadowAiOutputMode = (env = process.env) => env.SHADOW_AI_OUTPUT_MODE === "text_json_local" ? "text_json_local" : "anthropic_json_schema";

const textualJsonContract = `Entrega exclusivamente un objeto JSON válido, sin Markdown ni texto adicional. Debe cumplir exactamente este JSON Schema; el servidor lo validará localmente y cualquier salida inválida será bloqueada:\n${JSON.stringify(shadowAiDecisionJsonSchema)}`;

// General 3A cannot select another schema through options, env or metadata.
export function createAnthropicShadowResponse(messages, options = {}) {
  return createAnthropicResponse(messages, options, false);
}

// Issued only by the dedicated Replay gateway, after messages have been bound
// to their privacy scope. This non-serializable capability is single-use and
// cannot be reused with another run/round's message array. No global flag.
export function createHistoricalReplayReducedTransport(messages, replaySchemaContext) {
  assertHistoricalReplaySchemaContext(replaySchemaContext);
  let consumed = false;
  return async (actualMessages, options = {}) => {
    assertHistoricalReplaySchemaContext(replaySchemaContext);
    if (consumed || actualMessages !== messages) throw new Error("historical_replay_transport_context_mismatch");
    consumed = true;
    return createAnthropicResponse(actualMessages, options, true);
  };
}

async function createAnthropicResponse(messages, { signal, fetchImpl = fetch, env = process.env, onPhase = () => {}, outputMode = shadowAiOutputMode(env) } = {}, reducedReplaySchema) {
  let verificationStage = "pre_provider_failed";
  let providerInvoked = false;
  const privacyReceipt = () => verificationStage === "serialized_body_verified" ? {
    final_payload_verified: true, serialized_body_verified: true, output_mode: outputMode,
    privacy_stage: "final_model_privacy", provider_invoked: providerInvoked,
  } : { privacy_stage: "final_model_privacy", privacy_failure_code: verificationStage, provider_invoked: false };
  try {
  const system = messages.find((item) => item.role === "system")?.content || "";
  const userMessages = messages.filter((item) => item.role !== "system");
  if (!SHADOW_AI_OUTPUT_MODES.includes(outputMode)) throw new Error("invalid_shadow_ai_output_mode");
  if (reducedReplaySchema && outputMode !== "anthropic_json_schema") throw new Error("historical_replay_reduced_schema_requires_json_schema");
  const body = {
    model: env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL,
    system: outputMode === "text_json_local" ? `${system}\n\n${textualJsonContract}` : system,
    messages: userMessages,
    max_tokens: Number(env.SHADOW_AI_MAX_OUTPUT_TOKENS || 1400),
    ...(outputMode === "anthropic_json_schema" ? { output_config: { format: { type: "json_schema", schema: reducedReplaySchema ? buildReducedAnthropicDecisionSchema() : anthropicShadowAiDecisionJsonSchema } } } : {}),
  };
  onPhase("connecting");
  verificationStage = "final_payload_rejected";
  const serializedBody = serializeVerifiedAnthropicBody(body, messages, (stage) => {
    // These events originate immediately after the existing checks/serialization.
    // No payload, fragment, alias, identifier or content-derived count is observed.
    verificationStage = stage === "final_payload_verified" ? "body_serialization_failed"
      : stage === "body_serialized" ? "serialized_body_rejected" : "serialized_body_verified";
  });
  providerInvoked = true;
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST", signal,
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: serializedBody,
  });
  onPhase("body");
  if (!response.ok) {
    let body = null;
    try { body = await response.json(); } catch { /* Never persist an unparsed provider body. */ }
    throw new AnthropicProviderError(sanitizeAnthropicError(response, body));
  }
  const json = await response.json();
  onPhase("complete");
  return recordModelPrivacyReceipt({ id: json.id, text: (json.content || []).find((block) => block.type === "text")?.text, usage: json.usage || {}, model: json.model || env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL, reportedModel: json.model || null, outputMode }, privacyReceipt());
  } catch (error) {
    recordModelPrivacyReceipt(error, privacyReceipt());
    throw error;
  }
}

export async function createAnthropicShadowRepairResponse(invalidText, { signal, fetchImpl = fetch, env = process.env, onPhase = () => {} } = {}) {
  const safeInput = String(invalidText || "").slice(0, 24000);
  return createAnthropicShadowResponse([
    { role: "system", content: "Repara sintaxis y estructura. Devuelve exclusivamente el objeto JSON corregido. No agregues hechos, herramientas, explicaciones ni Markdown." },
    { role: "user", content: safeInput },
  ], { signal, fetchImpl, env, onPhase, outputMode: "text_json_local" });
}
