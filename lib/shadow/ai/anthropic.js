import { anthropicShadowAiDecisionJsonSchema, shadowAiDecisionJsonSchema } from "./schema.js";

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

export const SHADOW_AI_OUTPUT_MODES = Object.freeze(["anthropic_json_schema", "text_json_local"]);
export const shadowAiOutputMode = (env = process.env) => env.SHADOW_AI_OUTPUT_MODE === "text_json_local" ? "text_json_local" : "anthropic_json_schema";

const textualJsonContract = `Entrega exclusivamente un objeto JSON válido, sin Markdown ni texto adicional. Debe cumplir exactamente este JSON Schema; el servidor lo validará localmente y cualquier salida inválida será bloqueada:\n${JSON.stringify(shadowAiDecisionJsonSchema)}`;

export async function createAnthropicShadowResponse(messages, { signal, fetchImpl = fetch, env = process.env, onPhase = () => {}, outputMode = shadowAiOutputMode(env) } = {}) {
  const system = messages.find((item) => item.role === "system")?.content || "";
  const userMessages = messages.filter((item) => item.role !== "system");
  if (!SHADOW_AI_OUTPUT_MODES.includes(outputMode)) throw new Error("invalid_shadow_ai_output_mode");
  const body = {
    model: env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL,
    system: outputMode === "text_json_local" ? `${system}\n\n${textualJsonContract}` : system,
    messages: userMessages,
    max_tokens: Number(env.SHADOW_AI_MAX_OUTPUT_TOKENS || 1400),
    ...(outputMode === "anthropic_json_schema" ? { output_config: { format: { type: "json_schema", schema: anthropicShadowAiDecisionJsonSchema } } } : {}),
  };
  onPhase("connecting");
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST", signal,
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  onPhase("body");
  if (!response.ok) {
    let body = null;
    try { body = await response.json(); } catch { /* Never persist an unparsed provider body. */ }
    throw new AnthropicProviderError(sanitizeAnthropicError(response, body));
  }
  const json = await response.json();
  onPhase("complete");
  return { id: json.id, text: (json.content || []).find((block) => block.type === "text")?.text, usage: json.usage || {}, model: json.model || env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL, outputMode };
}

export async function createAnthropicShadowRepairResponse(invalidText, { signal, fetchImpl = fetch, env = process.env, onPhase = () => {} } = {}) {
  const safeInput = String(invalidText || "").slice(0, 24000);
  return createAnthropicShadowResponse([
    { role: "system", content: "Repara sintaxis y estructura. Devuelve exclusivamente el objeto JSON corregido. No agregues hechos, herramientas, explicaciones ni Markdown." },
    { role: "user", content: safeInput },
  ], { signal, fetchImpl, env, onPhase, outputMode: "text_json_local" });
}
