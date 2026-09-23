// Receipts are created by the real transport, never from provider content or
// injected model result properties. Only fixed enums/booleans leave this map.
const receipts = new WeakMap();
const MODES = new Set(["anthropic_json_schema", "text_json_local"]);
const FAILURES = new Set(["final_payload_rejected", "body_serialization_failed", "serialized_body_rejected", "pre_transport_privacy_blocked", "pre_provider_failed"]);

export function sanitizedModelPrivacyReceipt(value) {
  if (!value || value.privacy_stage !== "final_model_privacy") return null;
  if (value.provider_invoked === false && FAILURES.has(value.privacy_failure_code)) {
    return { privacy_stage: "final_model_privacy", privacy_failure_code: value.privacy_failure_code, provider_invoked: false };
  }
  if (value.final_payload_verified !== true || value.serialized_body_verified !== true
    || !MODES.has(value.output_mode) || typeof value.provider_invoked !== "boolean") return null;
  return {
    final_payload_verified: true, serialized_body_verified: true,
    output_mode: value.output_mode, privacy_stage: "final_model_privacy",
    provider_invoked: value.provider_invoked,
  };
}

export function recordModelPrivacyReceipt(target, value) {
  const receipt = sanitizedModelPrivacyReceipt(value);
  if (receipt && target !== null && ["object", "function"].includes(typeof target)) receipts.set(target, Object.freeze(receipt));
  return target;
}

export function modelPrivacyReceipt(target) {
  return sanitizedModelPrivacyReceipt(receipts.get(target));
}

// Also apply the projection on persistence/read, never spread arbitrary telemetry.
// Missing receipts (legacy rows or a simulated modelCall) are not a PASS.
export function sanitizedModelPrivacyChecks(values) {
  return Array.isArray(values) ? values.map(sanitizedModelPrivacyReceipt).filter(Boolean) : [];
}
