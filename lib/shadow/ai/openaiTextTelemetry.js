import { modelPrivacyReceipt } from "./modelPrivacyTelemetry.js";
import { projectOutputPrivacyFailure } from "./outputPrivacyDiagnostics.js";
import { projectStructuredOutputFailure } from "./structuredOutputDiagnostics.js";

const codes = new Set(["model_timeout", "provider_http_error", "provider_response_invalid_json", "provider_invalid_session_reference",
  "provider_output_unavailable", "provider_output_ambiguous", "unexpected_provider_tool_action", "unexpected_provider_turn_count", "provider_turn_failed",
  "shadow_openai_key_missing", "shadow_openai_model_required", "pre_model_sanitization_blocked", "invalid_structured_output",
  "tool_timeout", "global_run_timeout", "manual_tool_write_forbidden", "text_3b_persistence_failed", "text_result_persistence_failed",
  "text_round_limit", "text_model_changed"]);
export function openAiTextFailure(error, stage = "provider_response") {
  const privacy = projectOutputPrivacyFailure(error), structured = projectStructuredOutputFailure(error);
  if (privacy) return { ...privacy, error_code: "pre_model_sanitization_blocked" };
  if (structured) return { ...structured, error_code: "invalid_structured_output" };
  const raw = error?.timeoutStage || error?.code || error?.message;
  const code = codes.has(raw) ? raw : error?.name === "ShadowAiStructuredOutputError" ? "invalid_structured_output" : "shadow_text_execution_failed";
  const providerStage = ["pre_provider", "provider_response", "provider_http"].includes(error?.outputStage) ? error.outputStage : stage;
  return { error_code: code, outputStage: code.includes("timeout") ? "timeout" : code === "provider_http_error" ? "provider_http"
    : code === "pre_model_sanitization_blocked" ? "final_model_privacy" : providerStage,
    ...(code === "provider_http_error" ? { provider_http_status: error.httpStatus || null } : {}) };
}
export function openAiTextRound(result, round, durationMs) {
  const data = result?.openai || {};
  return { round_number: round, provider: "openai", output_mode: "openai_json_schema", receipt: modelPrivacyReceipt(result),
    provider_invoked: data.provider_invoked === true, model: data.model || null, model_provenance: data.model_provenance || null,
    input_tokens: data.usage?.inputTokens ?? null, output_tokens: data.usage?.outputTokens ?? null,
    cached_input_tokens: data.usage?.cachedInputTokens ?? null, reasoning_tokens: data.usage?.reasoningTokens ?? null,
    estimated_cost_usd: data.estimated_cost_usd ?? null, latency_ms: durationMs,
    session_ref: data.session_ref || null, turn_ref: data.turn_ref || null, cancellation: data.cancellation || "not_needed" };
}
export function openAiTextTotals(telemetry) {
  const rounds = telemetry.model_requests || [];
  const sum = key => rounds.length && rounds.every(r => typeof r[key] === "number" && Number.isFinite(r[key])) ? rounds.reduce((n, r) => n + r[key], 0) : null;
  return { input_tokens: sum("input_tokens"), output_tokens: sum("output_tokens"), estimated_cost_usd: sum("estimated_cost_usd") };
}
