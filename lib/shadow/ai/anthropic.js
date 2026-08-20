import { shadowAiDecisionJsonSchema } from "./schema.js";

export const DEFAULT_SHADOW_AI_MODEL = "claude-haiku-4-5-20251001";

export async function createAnthropicShadowResponse(messages, { signal, fetchImpl = fetch, env = process.env } = {}) {
  const system = messages.find((item) => item.role === "system")?.content || "";
  const userMessages = messages.filter((item) => item.role !== "system");
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST", signal,
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL,
      system,
      messages: userMessages,
      max_tokens: Number(env.SHADOW_AI_MAX_OUTPUT_TOKENS || 1400),
      output_config: { format: { type: "json_schema", schema: shadowAiDecisionJsonSchema } },
    }),
  });
  if (!response.ok) throw new Error(`model_http_${response.status}`);
  const json = await response.json();
  return { id: json.id, text: (json.content || []).find((block) => block.type === "text")?.text, usage: json.usage || {}, model: json.model || env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL };
}
