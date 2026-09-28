import { READ_ONLY_SHADOW_TOOLS, SHADOW_TOOL_ARGUMENT_SCHEMAS } from "../context.js";

// Fixed output-failure vocabulary only. No model text, paths, references, or
// values enter these receipts. Shared with GET/UI for independent reprojection.
export const OUTPUT_PRIVACY_REASONS = Object.freeze([
  "model_alias_in_free_text", "model_reference_wrong_position",
  "unissued_model_reference", "unissued_or_raw_model_reference", "model_reference_type_mismatch",
  "missing_model_privacy_scope", "residual_uuid", "residual_internal_identifier",
  "residual_internal_reference", "unaliased_reference_field", "residual_digest_or_token",
  "residual_url", "residual_phone_or_account", "residual_email", "residual_secret",
  "residual_long_number", "residual_labeled_identifier", "residual_address",
  "residual_address_reference", "residual_explicit_person", "residual_capitalized_pair",
  "privacy_string_limit", "privacy_structure_limit", "prohibited_private_field",
  "non_json_value", "non_plain_payload", "non_json_property",
]);
export const OUTPUT_PRIVACY_LOCATIONS = Object.freeze([
  "summary", "context_assessment", "proposed_action", "conversation_text",
  "tool_argument", "resolved_entity", "factual_claim_evidence",
  "verified_fact_reference", "other_output_field",
]);
const reasons = new Set(OUTPUT_PRIVACY_REASONS);
const locations = new Set(OUTPUT_PRIVACY_LOCATIONS);
const stages = new Set(["output_privacy_validation", "output_reference_decode"]);
const failures = new WeakMap();
// Fixed vocabulary for diagnostics only, not a reference compatibility rule.
// Capture receives the expected type from modelReferenceType, never scope data.
// Dynamic source:<model text> types are deliberately omitted (including on GET).
const expectedReferenceTypes = new Set([
  "respond_contact", "property_reference", "property", "contract", "payment",
  "service", "maintenance_ticket", "work_center_case", "key", "owner_liquidation",
  "policy_record", "condominium_unit", "client_identity", "administrative_work",
]);
const referenceDecodeReasons = new Set(["unissued_or_raw_model_reference", "model_reference_type_mismatch"]);

export function sanitizedOutputPrivacyDiagnostics(value) {
  if (!value || !stages.has(value.outputStage)) return null;
  const safe = { outputStage: value.outputStage };
  if (reasons.has(value.outputPrivacy?.reason) && locations.has(value.outputPrivacy?.location)) {
    safe.outputPrivacy = { reason: value.outputPrivacy.reason, location: value.outputPrivacy.location };
    const detail = value.outputPrivacy;
    if (value.outputStage === "output_reference_decode" && detail.location === "tool_argument"
      && referenceDecodeReasons.has(detail.reason) && READ_ONLY_SHADOW_TOOLS.includes(detail.tool)
      && typeof detail.argument_key === "string"
      && Object.hasOwn(SHADOW_TOOL_ARGUMENT_SCHEMAS[detail.tool].properties, detail.argument_key)) {
      safe.outputPrivacy.tool = detail.tool;
      safe.outputPrivacy.argument_key = detail.argument_key;
      if (expectedReferenceTypes.has(detail.expected_reference_type)) {
        safe.outputPrivacy.expected_reference_type = detail.expected_reference_type;
      }
    }
  }
  return safe;
}

// Called only at the output boundary. Incoming/model-supplied error properties
// cannot become a receipt; reasons are projected before entering the WeakMap.
export function recordOutputPrivacyFailure(error, value) {
  const safe = sanitizedOutputPrivacyDiagnostics(value);
  if (safe) failures.set(error, safe);
}
export function projectOutputPrivacyFailure(error) {
  return sanitizedOutputPrivacyDiagnostics(failures.get(error));
}

// The traversal may examine arbitrary keys; only comparisons with these fixed
// schema positions select a category. Never return a key or a dynamic path.
export function modelOutputLocation(path) {
  if (path[0] === "summary") return "summary";
  if (path[0] === "contextAssessment") return "context_assessment";
  if (path[0] === "proposedAction") return "proposed_action";
  if (path[0] === "resolvedEntities") return "resolved_entity";
  if (path[0] === "proposedToolCalls" && path[2] === "arguments") return "tool_argument";
  if (path[0] === "factualClaims" && path[2] === "evidenceIds") return "factual_claim_evidence";
  if (path[0] === "conversationalResponseParts" && path[1] === "verifiedFactReferences") return "verified_fact_reference";
  if (path[0] === "conversationalResponseParts" || path[0] === "escalationReason" || path[0] === "proposed_message") return "conversation_text";
  return "other_output_field";
}

// For an output-privacy failure retain only the constant error code and the
// projected enums. Legacy generic failures never acquire an inferred cause.
export function reprojectOutputPrivacyDiagnostics(value) {
  if (!value || typeof value !== "object") return value;
  const safe = sanitizedOutputPrivacyDiagnostics(value);
  if (safe) return { ...safe, diagnosticCode: "pre_model_sanitization_blocked", truncatedFields: [] };
  if (value.diagnosticCode === "pre_model_sanitization_blocked" || value.outputStage === "final_model_privacy") {
    return { outputStage: "final_model_privacy", diagnosticCode: "pre_model_sanitization_blocked", truncatedFields: [] };
  }
  const { outputPrivacy, ...legacy } = value;
  return legacy;
}
