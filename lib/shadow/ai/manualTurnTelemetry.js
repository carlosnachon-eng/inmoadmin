import { modelPrivacyReceipt, sanitizedModelPrivacyReceipt } from "./modelPrivacyTelemetry.js";
import { projectOutputPrivacyFailure, sanitizedOutputPrivacyDiagnostics } from "./outputPrivacyDiagnostics.js";
import { projectStructuredOutputFailure, sanitizedStructuredOutputDiagnostics } from "./structuredOutputDiagnostics.js";
import { projectProviderHttpError, sanitizedProviderHttpDiagnostics, reportedTokenCount } from "./providerHttpDiagnostics.js";
import { READ_ONLY_SHADOW_TOOLS } from "../context.js";

const stages = new Set(["json_parsing", "structured_validation", "output_reference_decode", "output_privacy_validation", "provider_http", "timeout", "final_model_privacy", "tool_execution", "decision_persistence", "3B", "result_persistence", "input_validation"]);
const codes = new Set(["manual_tool_write_forbidden", "manual_turn_timeout", "manual_decision_persistence_failed", "manual_3b_persistence_failed", "manual_result_persistence_failed", "manual_input_changed", "pre_model_sanitization_blocked", "invalid_structured_output", "manual_turn_execution_failed"]);
export function manualFailure(error, stage) {
  const privacy = projectOutputPrivacyFailure(error), structured = projectStructuredOutputFailure(error);
  const http = projectProviderHttpError(error?.providerError);
  return {
    outputStage: privacy?.outputStage || structured?.outputStage || (http ? "provider_http" : error?.timeoutStage ? "timeout" : stages.has(stage) ? stage : "structured_validation"),
    error_code: http ? `model_http_${http.provider_http_status}` : codes.has(error?.message) ? error.message : "manual_turn_execution_failed",
    ...(privacy ? { outputPrivacy: privacy.outputPrivacy } : {}),
    ...(structured ? { diagnosticCode: structured.diagnosticCode, structuredOutput: structured.structuredOutput } : {}),
    ...(http ? { providerHttp: http } : {}),
  };
}
export function manualReceipt(target, round, durationMs) {
  const receipt = modelPrivacyReceipt(target);
  return { round, duration_ms: Math.max(0, durationMs), receipt: receipt || null,
    model: typeof target?.reportedModel === "string" && /^claude-[a-z0-9.-]{1,70}$/.test(target.reportedModel) ? target.reportedModel : null,
    input_tokens: reportedTokenCount(target?.usage?.input_tokens), output_tokens: reportedTokenCount(target?.usage?.output_tokens) };
}
export function safeManualTelemetry(value = {}) {
  const failure = value.failure || {};
  const privacy = sanitizedOutputPrivacyDiagnostics(failure), structured = sanitizedStructuredOutputDiagnostics(failure);
  const http = sanitizedProviderHttpDiagnostics(failure.providerHttp);
  return {
    rounds: (value.rounds || []).slice(0, 2).map((r) => ({ round: [1, 2].includes(r.round) ? r.round : null,
      duration_ms: reportedTokenCount(r.duration_ms), receipt: sanitizedModelPrivacyReceipt(r.receipt),
      model: /^claude-[a-z0-9.-]{1,70}$/.test(r.model || "") ? r.model : null,
      input_tokens: reportedTokenCount(r.input_tokens), output_tokens: reportedTokenCount(r.output_tokens) })),
    tools: (value.tools || []).filter((t) => READ_ONLY_SHADOW_TOOLS.includes(t.name)).map((t) => ({
      round: [1, 2].includes(t.round) ? t.round : null, name: t.name, ok: t.ok === true,
      source: ["model", "policy", "model_proposed", "policy_required", "both"].includes(t.source) ? t.source : null,
      duration_ms: reportedTokenCount(t.duration_ms), rows: reportedTokenCount(t.rows),
      ...(t.name === "resolve_contact_identity" && typeof t.identity_resolved === "boolean" ? { identity_resolved: t.identity_resolved } : {}),
    })),
    persistence: { decision: value.persistence?.decision === true, operational_resolution: value.persistence?.operational_resolution === true,
      conversation_action: value.persistence?.conversation_action === true, verified: value.persistence?.verified === true },
    ...(stages.has(failure.outputStage) ? { failure: { outputStage: failure.outputStage,
      error_code: codes.has(failure.error_code) || /^model_http_[45]\d\d$/.test(failure.error_code || "") ? failure.error_code : "manual_turn_execution_failed",
      ...(privacy?.outputPrivacy ? { outputPrivacy: privacy.outputPrivacy } : {}),
      ...(structured ? { diagnosticCode: structured.diagnosticCode, ...(structured.structuredOutput ? { structuredOutput: structured.structuredOutput } : {}) } : {}),
      ...(http ? { providerHttp: http } : {}),
    } } : {}),
  };
}
