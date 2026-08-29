import { anthropicShadowAiDecisionJsonSchema } from "./schema.js";

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

export async function createAnthropicShadowResponse(messages, { signal, fetchImpl = fetch, env = process.env, onPhase = () => {} } = {}) {
  const system = messages.find((item) => item.role === "system")?.content || "";
  const userMessages = messages.filter((item) => item.role !== "system");
  onPhase("connecting");
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST", signal,
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL,
      system,
      messages: userMessages,
      max_tokens: Number(env.SHADOW_AI_MAX_OUTPUT_TOKENS || 1400),
      output_config: { format: { type: "json_schema", schema: anthropicShadowAiDecisionJsonSchema } },
    }),
  });
  onPhase("body");
  if (!response.ok) {
    let body = null;
    try { body = await response.json(); } catch { /* Never persist an unparsed provider body. */ }
    throw new AnthropicProviderError(sanitizeAnthropicError(response, body));
  }
  const json = await response.json();
  onPhase("complete");
  return { id: json.id, text: (json.content || []).find((block) => block.type === "text")?.text, usage: json.usage || {}, model: json.model || env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL };
}
