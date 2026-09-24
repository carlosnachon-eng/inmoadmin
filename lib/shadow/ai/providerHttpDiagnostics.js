import { createHash } from "node:crypto";

// Provider-controlled strings are not safe merely because they are short or
// syntactically identifier-like. Only these fixed vocabulary entries may leave
// memory. Unknown values stay null; the free-form message is never persisted.
const TYPES = new Set([
  "invalid_request_error", "authentication_error", "billing_error", "permission_error",
  "not_found_error", "conflict_error", "request_too_large", "rate_limit_error",
  "api_error", "timeout_error", "overloaded_error",
]);
const CODES = new Set([...TYPES, "error", "invalid_json_schema", "unsupported_schema",
  "invalid_parameter", "missing_required_parameter", "model_not_found", "context_length_exceeded"]);
const PARAMS = new Set([
  "model", "max_tokens", "system", "messages", "messages[].role", "messages[].content",
  "messages[].content[].type", "messages[].content[].text", "output_config",
  "output_config.format", "output_config.format.type", "output_config.format.schema",
  "tools", "tool_choice", "temperature", "thinking", "stream",
]);
const MESSAGE_CATEGORIES = Object.freeze([
  ["schema_too_complex", /\b(?:json )?schema (?:is )?too complex for compilation\b/i],
  ["schema_compilation_timeout", /\b(?:schema compilation (?:timed out|timeout)|(?:timed out|timeout) (?:while )?compiling (?:the )?(?:json )?schema)\b/i],
  ["invalid_json_schema", /\b(?:invalid (?:json )?schema|schema is invalid)\b/i],
  ["unsupported_json_schema", /\b(?:unsupported (?:json )?schema|schema (?:feature|keyword) (?:is )?not supported)\b/i],
  ["context_limit_exceeded", /\b(?:prompt is too long|context length exceeded)\b/i],
  ["max_tokens_invalid", /\bmax_tokens (?:must be|must not exceed|is invalid)\b/i],
  ["model_unavailable", /\b(?:model not found|model does not exist)\b/i],
  ["spend_limit_reached", /\b(?:credit balance is too low|spend limit (?:has been )?(?:reached|exceeded))\b/i],
]);
const CATEGORIES = new Set(MESSAGE_CATEGORIES.map(([category]) => category));
const allowed = (value, set) => typeof value === "string" && set.has(value) ? value : null;
const httpStatus = (value) => Number.isInteger(value) && value >= 400 && value <= 599 ? value : null;
const safeParam = (value) => {
  if (typeof value !== "string") return null;
  // Attribute a schema path to its fixed root without copying arbitrary
  // property names (or values) echoed after that root by the provider.
  if (value.startsWith("output_config.format.schema.")) return "output_config.format.schema";
  return allowed(value.replace(/\[\d{1,3}\]|\.\d{1,3}(?=\.|$)/g, "[]"), PARAMS);
};

export function opaqueProviderRequestRef(value) {
  // Hash only an explicitly shaped provider request ID, never a body/message.
  if (typeof value !== "string" || !/^req_[A-Za-z0-9]{16,80}$/.test(value)) return null;
  return createHash("sha256").update(`anthropic-request:${value}`).digest("hex");
}

export function projectProviderHttpError(details) {
  const status = httpStatus(details?.provider_status);
  if (status === null) return null;
  const message = typeof details.provider_error_message === "string" ? details.provider_error_message.slice(0, 300) : "";
  const category = MESSAGE_CATEGORIES.find(([, pattern]) => pattern.test(message))?.[0];
  return sanitizedProviderHttpDiagnostics({
    provider_http_status: status,
    provider_error_type: details.provider_error_type,
    provider_error_code: details.provider_error_code,
    provider_error_param: safeParam(details.provider_error_field),
    provider_request_ref: opaqueProviderRequestRef(details.provider_request_id),
    ...(category ? { provider_error_message_safe: category } : {}),
  });
}

// Reapply the projection at persistence and GET. Never spread providerError.
export function sanitizedProviderHttpDiagnostics(value) {
  const status = httpStatus(value?.provider_http_status);
  if (status === null) return null;
  const result = {
    provider_http_status: status,
    provider_error_type: allowed(value.provider_error_type, TYPES),
    provider_error_code: allowed(value.provider_error_code, CODES),
    provider_error_param: allowed(value.provider_error_param, PARAMS),
    provider_request_ref: typeof value.provider_request_ref === "string" && /^[a-f0-9]{64}$/.test(value.provider_request_ref) ? value.provider_request_ref : null,
  };
  const category = allowed(value.provider_error_message_safe, CATEGORIES);
  if (category) result.provider_error_message_safe = category;
  return result;
}

export const reportedTokenCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function replayProviderUsage(input, output) {
  const input_tokens = reportedTokenCount(input), output_tokens = reportedTokenCount(output);
  const known = input_tokens !== null && output_tokens !== null;
  return { input_tokens, output_tokens, usage_status: known ? "reported" : "unknown",
    estimated_cost_usd: known ? Number((input_tokens * 0.000001 + output_tokens * 0.000005).toFixed(6)) : null };
}

export function storedReplayProviderAccounting(row) {
  const usage = row?.result_safe?.providerUsage;
  if (usage) {
    const safe = replayProviderUsage(usage.input_tokens, usage.output_tokens);
    return { ...safe, provider_model_status: ["reported", "partial"].includes(row.result_safe.providerModelStatus) ? row.result_safe.providerModelStatus : "unaccredited" };
  }
  // Historical HTTP errors stored accumulator defaults, not provider usage.
  // Do not mutate/backfill those rows or invent evidence from configuration.
  if (/^model_http_[45]\d\d$/.test(row?.error_code || "")) return { ...replayProviderUsage(null, null), provider_model_status: "unaccredited" };
  return {};
}

// Legacy SQL columns are NOT NULL. Omit unknown values instead of coercing to
// zero; result_safe.providerUsage is authoritative and GET overrides defaults.
export function replayUsageColumns(usage) {
  return Object.fromEntries(["input_tokens", "output_tokens", "estimated_cost_usd"]
    .filter((key) => usage[key] !== null).map((key) => [key, usage[key]]));
}
