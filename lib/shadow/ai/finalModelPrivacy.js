import { verifyPreModelPayload } from "./preModelSanitizer.js";
import { SHADOW_AI_SYSTEM_PROMPT, SHADOW_AI_TOOL_GUIDE } from "./prompt.js";
import { REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "./realPrompt.js";
import { shadowAiDecisionJsonSchema } from "./schema.js";
import { modelPrivacyReceipt, recordModelPrivacyReceipt } from "./modelPrivacyTelemetry.js";
import { modelOutputLocation, recordOutputPrivacyFailure } from "./outputPrivacyDiagnostics.js";

// These maps never enter modelOptions, JSON, telemetry, or persisted round state.
const messageScopes = new WeakMap();
const resultScopes = new WeakMap();
const REPAIR_PROMPT = "Repara sintaxis y estructura. Devuelve exclusivamente el objeto JSON corregido. No agregues hechos, herramientas, explicaciones ni Markdown.";
const TEXT_CONTRACT = `Entrega exclusivamente un objeto JSON válido, sin Markdown ni texto adicional. Debe cumplir exactamente este JSON Schema; el servidor lo validará localmente y cualquier salida inválida será bloqueada:\n${JSON.stringify(shadowAiDecisionJsonSchema)}`;
const STATIC_SYSTEMS = new Set([
  `${SHADOW_AI_SYSTEM_PROMPT}\n\n${SHADOW_AI_TOOL_GUIDE}`,
  `${REAL_SHADOW_AI_SYSTEM_PROMPT}\n\n${REAL_SHADOW_AI_TOOL_GUIDE}`,
  REPAIR_PROMPT,
].flatMap((text) => [text, `${text}\n\n${TEXT_CONTRACT}`]));

export class FinalModelPrivacyError extends Error {
  constructor(reason) {
    super("pre_model_sanitization_blocked");
    this.code = "pre_model_sanitization_blocked";
    this.reasons = [reason];
    this.outputStage = "final_model_privacy";
  }
}
const block = (reason, outputStage, location) => {
  const error = new FinalModelPrivacyError(reason);
  if (outputStage) {
    error.outputStage = outputStage;
    recordOutputPrivacyFailure(error, { outputStage, outputPrivacy: { reason, location } });
  }
  throw error;
};
const UUID = /\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/iu;
const ALIAS = /\bref_[A-Za-z]+_\d+\b/gu;
const ID_KEY = /(?:^ids?$|^uuids?$|^internalId$|Id$|Ids$|Ref$|_id$|_ids$|_ref$|^contextKey$|^workCenterContextKey$|^propertyReference$|^subjectId$|^evidenceId$)/u;
const PRIVATE_KEY = /^(?:password|passwd|secrets?|tokens?|api[-_ ]?key|access_?token|refresh_?token|auth_?token|authorization|cookie|session|credentials?|phone|telephone|telefono|email|e_mail|account|(?:bank_?)?account_?number|bank_?account|clabe|(?:credit_?)?card(?:_?number)?|address|domicilio|full_?name|first_?name|last_?name|owner_?name|tenant_?name|contact_?name)$/iu;
const REFERENCE_TYPES = Object.freeze({
  respondContactId: "respond_contact", respond_contact_id: "respond_contact",
  propertyId: "property", propertyReference: "property_reference", contractId: "contract",
  paymentId: "payment", serviceId: "service", ticketId: "maintenance_ticket", keyId: "key",
  ownerPaymentId: "owner_liquidation", contextKey: "work_center_case", workCenterContextKey: "work_center_case",
  recordId: "policy_record", unitId: "condominium_unit", condominiumId: "condominium",
  clientIdentityId: "client_identity", workItemId: "administrative_work", linkId: "identity_link",
  responsibleId: "user", evidenceId: "evidence",
});
const ENTITIES = new Set(["property", "contract", "payment", "service", "maintenance_ticket", "key", "owner_liquidation", "work_center_case", "policy_record", "condominium_unit", "condominium", "client_identity", "contact_identity", "administrative_work", "administrative_evidence", "administrative_history", "administrative_approval", "condominium_fee"]);
const TOOL_ENTITIES = Object.freeze({
  get_policy_or_signature_case: "policy_record", get_condominium_fee_summary: "condominium_fee",
  list_administrative_work: "administrative_work", get_administrative_work: "administrative_work",
  find_administrative_work_by_context: "administrative_work", find_possible_duplicate_work: "administrative_work",
  get_administrative_evidence_summary: "administrative_evidence", get_administrative_work_history: "administrative_history",
  get_pending_approvals: "administrative_approval",
});
const CANONICAL_IDENTITY_TYPES = new Set(["contact_identity", "client_identity"]);
export function areModelReferenceTypesCompatible(actual, expected) {
  return typeof actual === "string" && Boolean(actual) && typeof expected === "string" && Boolean(expected)
    && (actual === expected || (CANONICAL_IDENTITY_TYPES.has(actual) && CANONICAL_IDENTITY_TYPES.has(expected)));
}
export function modelReferenceType(key, row = {}, toolName = "") {
  if (REFERENCE_TYPES[key]) return REFERENCE_TYPES[key];
  if (key === "sourceId") return `source:${String(row.sourceType || "unknown")}`;
  if (["internalId", "id", "subjectId"].includes(key)) {
    // An unresolved contact row carries the Respond ID, not a canonical identity.
    if (row.entityType === "contact_identity" && row.resolved === false) return "respond_contact";
    return ENTITIES.has(row.entityType) ? row.entityType : TOOL_ENTITIES[toolName] || "unknown_record";
  }
  return null;
}

export function createModelPrivacyScope() {
  if (typeof window !== "undefined") block("server_only_privacy_scope");
  // Random namespace, not derived from any identity; aliases cannot cross rounds/runs.
  const namespace = [...globalThis.crypto.getRandomValues(new Uint8Array(32))].map((byte) => String.fromCharCode(97 + (byte % 26))).join("");
  const reverse = new Map(); const forward = new Map(); const internalValues = new Set(); const textAliases = new Map();
  const reference = (value, type) => {
    if (value === null || value === undefined || value === "") return null;
    if (!type || !["string", "number"].includes(typeof value)) block("invalid_reference_shape");
    const internal = String(value);
    if (internal.length > 240) block("invalid_reference_length");
    const key = JSON.stringify([type, internal]);
    if (!forward.has(key)) {
      const alias = `ref_${namespace}_${forward.size + 1}`;
      forward.set(key, alias); reverse.set(alias, { type, internal }); internalValues.add(internal);
      if (!textAliases.has(internal)) textAliases.set(internal, alias);
    }
    return forward.get(key);
  };
  const resolve = (alias, type) => {
    if (typeof alias !== "string" || !reverse.has(alias)) block("unissued_or_raw_model_reference");
    const entry = reverse.get(alias);
    if (!areModelReferenceTypesCompatible(entry.type, type)) block("model_reference_type_mismatch");
    return entry.internal;
  };
  const anonymizeReferenceText = (value) => {
    if (typeof value !== "string" || reverse.has(value)) return value;
    if (textAliases.has(value)) return textAliases.get(value);
    for (const [internal, alias] of [...textAliases].sort((a, b) => b[0].length - a[0].length)) {
      if (internal.length >= 4) value = value.split(internal).join(alias);
    }
    return value;
  };
  return { reference, resolve, has: (value) => reverse.has(value), internalValues, anonymizeReferenceText };
}

function inspectText(text, scope, reasons) {
  if (!text) return;
  if (text.length > 64000) { reasons.add("privacy_string_limit"); return; }
  for (const match of text.matchAll(ALIAS)) if (!scope?.has(match[0])) reasons.add("unissued_model_reference");
  const withoutAliases = text.replace(ALIAS, "[REFERENCE]");
  if (UUID.test(withoutAliases)) reasons.add("residual_uuid");
  if (/\b(?:respond[_-]?contact[_-]?id|(?:property|contract|payment|service|ticket|user|run|contact)[-:#])\s*[=:]?\s*[A-Za-z0-9._:-]+/iu.test(withoutAliases)) reasons.add("residual_internal_identifier");
  if (/\b[a-f0-9]{12,}\b/iu.test(withoutAliases)) reasons.add("residual_digest_or_token");
  if (/\b[a-z][a-z0-9+.-]{1,20}:\/\/\S+|(?:^|\s)\/\/[^\s]+/iu.test(withoutAliases)) reasons.add("residual_url");
  if (/(?<!\d)(?:\+?\d[\s().-]*){10,19}(?!\d)/u.test(withoutAliases)) reasons.add("residual_phone_or_account");
  for (const internal of scope?.internalValues || []) {
    if (withoutAliases === internal || (internal.length >= 4 && withoutAliases.includes(internal))) reasons.add("residual_internal_reference");
  }
  // Reuse the certified rules, without truncating a long string. Overlap covers
  // residuals crossing a chunk boundary; length-only errors are not PII errors.
  for (let start = 0; start < withoutAliases.length; start += 1000) {
    const check = verifyPreModelPayload({ message: withoutAliases.slice(start, start + 2000) });
    for (const reason of check.reasons) if (reason !== "invalid_message_length") reasons.add(reason);
  }
}

// All keys AND values are inspected, including unknown future fields. Only exact
// checked-in static system prompts may bypass natural-language PII heuristics;
// this exception is path-specific and never applies to user/context/tool data.
function inspectFinalModelPayload(payload, { scope = null, transport = false } = {}) {
  const reasons = new Set(); const seen = new Set(); let nodes = 0;
  const locations = new Map();
  const at = (path) => ({ add(reason) {
    reasons.add(reason);
    if (!locations.has(reason)) locations.set(reason, modelOutputLocation(path));
  } });
  const visit = (value, path = [], key = "") => {
    const reasons = at(path);
    if (++nodes > 20000 || path.length > 40) { reasons.add("privacy_structure_limit"); return; }
    if (PRIVATE_KEY.test(key) && value !== null && value !== "") reasons.add("prohibited_private_field");
    if (typeof value === "string") {
      const staticSystem = transport && (path.join(".") === "system" || (path.length === 3 && path[0] === "messages" && path[2] === "content" && payload.messages?.[path[1]]?.role === "system"));
      if (staticSystem && STATIC_SYSTEMS.has(value)) return;
      if (staticSystem && value.endsWith(`\n\n${TEXT_CONTRACT}`)) {
        inspectText(value.slice(0, -TEXT_CONTRACT.length - 2), scope, reasons); return;
      }
      if (transport && path.join(".") === "model" && value === "claude-haiku-4-5-20251001") return;
      if (ID_KEY.test(key) && value && !scope?.has(value)) reasons.add("unaliased_reference_field");
      // JSON in Anthropic message.content is inspected structurally as well.
      if (/^\s*[\[{]/u.test(value)) {
        let decoded; try { decoded = JSON.parse(value); } catch { /* repair/plain text */ }
        if (decoded && typeof decoded === "object") { visit(decoded, [...path, "json"]); return; }
      }
      inspectText(value, scope, reasons); return;
    }
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) reasons.add("non_json_value");
      if (ID_KEY.test(key)) reasons.add("unaliased_reference_field");
      inspectText(String(value), scope, reasons); return;
    }
    if (typeof value !== "object" || seen.has(value)) { reasons.add("non_json_value"); return; }
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) { reasons.add("non_plain_payload"); return; }
    seen.add(value);
    for (const [field, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (Array.isArray(value) && field === "length") continue;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value") || field === "toJSON") { reasons.add("non_json_property"); continue; }
      inspectText(field, scope, at([...path, field]));
      visit(descriptor.value, [...path, field], Array.isArray(value) && ID_KEY.test(key) ? key : field);
    }
    seen.delete(value);
  };
  visit(payload);
  return { allowed: reasons.size === 0, reasons: [...reasons].sort(), locations };
}
export function verifyFinalModelPayload(payload, options = {}) {
  const { allowed, reasons } = inspectFinalModelPayload(payload, options);
  return { allowed, reasons };
}
const assertVerified = (value, scope, transport = false, output = false) => {
  const checked = inspectFinalModelPayload(value, { scope, transport });
  if (!checked.allowed) block(checked.reasons[0], output ? "output_privacy_validation" : undefined, checked.locations.get(checked.reasons[0]));
};
const freeze = (value) => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function bindVerifiedModelMessages(messages, scope) {
  assertVerified({ messages }, scope, true);
  const copy = JSON.parse(JSON.stringify(messages));
  assertVerified({ messages: copy }, scope, true);
  messageScopes.set(copy, scope);
  return freeze(copy);
}
export function serializeVerifiedAnthropicBody(body, messages, onVerified = () => {}) {
  const scope = messageScopes.get(messages);
  assertVerified(body, scope, true);
  onVerified("final_payload_verified");
  const serialized = JSON.stringify(body);
  onVerified("body_serialized");
  // Verify the actual serialization too; return that same immutable string to fetch.
  assertVerified(JSON.parse(serialized), scope, true);
  onVerified("serialized_body_verified");
  return serialized;
}
export function bindModelResult(result, messages) {
  const copy = { ...result };
  resultScopes.set(copy, messageScopes.get(messages));
  recordModelPrivacyReceipt(copy, modelPrivacyReceipt(result));
  return copy;
}
export function scopeForModelResult(result) { return resultScopes.get(result); }

// Output policy: reject, never expand references in prose. Legitimate structured
// references have already been decoded server-side. Scan every remaining field
// (including future fields/keys) before any executor can use or persist a decision.
function assertNoEphemeralAliases(value, path = []) {
  if (typeof value === "string") {
    // No word boundaries: concatenating text must not hide an issued alias.
    if (/ref_[A-Za-z]+_\d+/u.test(value)) block("model_alias_in_free_text", "output_privacy_validation", modelOutputLocation(path));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertNoEphemeralAliases(key, [...path, key]);
      assertNoEphemeralAliases(child, [...path, key]);
    }
  }
}

function decodeReferences(decision, result) {
  const scope = resultScopes.get(result);
  if (!scope) block("missing_model_privacy_scope", "output_reference_decode", "other_output_field");
  const resolve = (alias, type, location) => {
    try { return scope.resolve(alias, type); }
    catch (error) {
      if (error instanceof FinalModelPrivacyError) {
        error.outputStage = "output_reference_decode";
        recordOutputPrivacyFailure(error, { outputStage: error.outputStage, outputPrivacy: { reason: error.reasons[0], location } });
      }
      throw error;
    }
  };
  // Detect raw identifiers anywhere, before resolving even one argument/tool.
  assertVerified(decision, scope, false, true);
  const decoded = structuredClone(decision);
  for (const entity of decoded.resolvedEntities || []) entity.internalId = resolve(entity.internalId, modelReferenceType("internalId", entity), "resolved_entity");
  for (const call of decoded.proposedToolCalls || []) {
    for (const [key, value] of Object.entries(call.arguments || {})) {
      const type = modelReferenceType(key, call.arguments, call.tool);
      if (type) call.arguments[key] = resolve(value, type, "tool_argument");
      else if (typeof value === "string" && [...value.matchAll(ALIAS)].length) block("model_reference_wrong_position", "output_reference_decode", "tool_argument");
    }
  }
  for (const claim of decoded.factualClaims || []) claim.evidenceIds = (claim.evidenceIds || []).map((id) => resolve(id, "evidence", "factual_claim_evidence"));
  if (decoded.conversationalResponseParts) decoded.conversationalResponseParts.verifiedFactReferences = (decoded.conversationalResponseParts.verifiedFactReferences || []).map((id) => resolve(id, "evidence", "verified_fact_reference"));
  assertNoEphemeralAliases(decoded);
  return decoded;
}

export function decodeModelDecisionReferences(decision, result) {
  try { return decodeReferences(decision, result); }
  catch (error) {
    // Preserve received usage, never raw text or the map, in failure telemetry.
    error.providerResult = { id: result?.id || null, usage: result?.usage || null };
    throw error;
  }
}
