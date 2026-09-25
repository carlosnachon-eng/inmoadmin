import test from "node:test";
import assert from "node:assert/strict";
import {
  OUTPUT_PRIVACY_REASONS, OUTPUT_PRIVACY_LOCATIONS, sanitizedOutputPrivacyDiagnostics,
  recordOutputPrivacyFailure, projectOutputPrivacyFailure, reprojectOutputPrivacyDiagnostics,
} from "../lib/shadow/ai/outputPrivacyDiagnostics.js";
import {
  createModelPrivacyScope, bindVerifiedModelMessages, bindModelResult,
  decodeModelDecisionReferences, verifyFinalModelPayload, FinalModelPrivacyError,
} from "../lib/shadow/ai/finalModelPrivacy.js";
import { decodeReducedShadowAiDecision } from "../lib/shadow/ai/reducedOutputSchema.js";

const rawId = "a1100000-0000-4000-8000-000000000001";
const sensitive = `${rawId} persona@example.com ref_private_1 sk-ant-syntheticSecret123456 +52 222 123 4567`;
const safe = (reason, location, outputStage = "output_privacy_validation") => ({ outputStage, outputPrivacy: { reason, location } });
function bound() {
  const scope = createModelPrivacyScope();
  const alias = scope.reference(rawId, "property");
  const evidence = scope.reference("synthetic-evidence", "evidence");
  const messages = bindVerifiedModelMessages([{ role: "user", content: "Consulta" }], scope);
  return { scope, alias, evidence, result: bindModelResult({ usage: { input_tokens: 5, output_tokens: 2 } }, messages) };
}
const decision = () => ({ intent: "mantenimiento", secondaryIntents: [], urgency: "normal", summary: "Consulta", entitiesMentioned: [], resolvedEntities: [], entityResolutionStatus: "unresolved", informationNeeded: [], proposedToolCalls: [], contextAssessment: "Contexto disponible", proposedAction: "Escalar", factualClaims: [], conversationalResponseParts: { acknowledgement: "Entiendo.", verifiedFactReferences: [], clarificationQuestion: null, escalationMessage: null }, executionCommitment: "none", confidence: .8, requiresHuman: true, escalationReason: "Revisión", safetyFlags: [] });
function failure(value, context, expected) {
  let caught;
  try { decodeModelDecisionReferences(value, context.result); } catch (error) { caught = error; }
  assert.ok(caught instanceof FinalModelPrivacyError);
  assert.equal(caught.code, "pre_model_sanitization_blocked");
  assert.deepEqual(projectOutputPrivacyFailure(caught), expected);
  assert.equal(caught.outputStage, expected.outputStage);
  const json = JSON.stringify(projectOutputPrivacyFailure(caught));
  for (const forbidden of [rawId, context.alias, context.evidence, sensitive]) assert.ok(!json.includes(forbidden));
  assert.deepEqual(caught.providerResult.usage, { input_tokens: 5, output_tokens: 2 });
  return caught;
}

for (const reason of OUTPUT_PRIVACY_REASONS) test(`allowlisted output reason only: ${reason}`, () => {
  const receipt = safe(reason, "other_output_field");
  const contaminated = { ...receipt, path: sensitive, value: sensitive, reasons: [sensitive], message: sensitive, body: sensitive,
    outputPrivacy: { ...receipt.outputPrivacy, path: sensitive, value: sensitive, alias: sensitive } };
  assert.deepEqual(sanitizedOutputPrivacyDiagnostics(contaminated), receipt);
  const error = new FinalModelPrivacyError(reason); error.message = sensitive;
  recordOutputPrivacyFailure(error, contaminated);
  assert.deepEqual(projectOutputPrivacyFailure(error), receipt);
  assert.deepEqual(reprojectOutputPrivacyDiagnostics(contaminated), { ...receipt, diagnosticCode: "pre_model_sanitization_blocked", truncatedFields: [] });
});
for (const location of OUTPUT_PRIVACY_LOCATIONS) test(`fixed location projection only: ${location}`, () => {
  assert.deepEqual(sanitizedOutputPrivacyDiagnostics(safe("residual_uuid", location)), safe("residual_uuid", location));
});

test("unknown reason/location/stage are never persisted; message/reasons cannot forge an output receipt", () => {
  for (const unknown of ["unknown_reason", sensitive, rawId, "ref_private_1"]) {
    assert.deepEqual(sanitizedOutputPrivacyDiagnostics(safe(unknown, "summary")), { outputStage: "output_privacy_validation" });
    assert.deepEqual(sanitizedOutputPrivacyDiagnostics(safe("residual_uuid", unknown)), { outputStage: "output_privacy_validation" });
    assert.equal(sanitizedOutputPrivacyDiagnostics(safe("residual_uuid", "summary", unknown)), null);
  }
  const error = new FinalModelPrivacyError("residual_uuid");
  Object.assign(error, safe("residual_uuid", "summary"));
  assert.equal(projectOutputPrivacyFailure(error), null);
  assert.equal(sanitizedOutputPrivacyDiagnostics(null), null);
});

const textFields = [
  ["summary", "summary", (d, a) => { d.summary = a; }],
  ["contextAssessment", "context_assessment", (d, a) => { d.contextAssessment = a; }],
  ["proposedAction", "proposed_action", (d, a) => { d.proposedAction = a; }],
  ...["acknowledgement", "clarificationQuestion", "escalationMessage"].map((field) => [field, "conversation_text", (d, a) => { d.conversationalResponseParts[field] = a; }]),
  ["escalationReason", "conversation_text", (d, a) => { d.escalationReason = a; }],
  ["proposed_message", "conversation_text", (d, a) => { d.proposed_message = a; }],
  ["entity label", "resolved_entity", (d, a) => { d.resolvedEntities = [{ entityType: "property", internalId: a, label: a }]; }],
  ["tool reason", "other_output_field", (d, a) => { d.proposedToolCalls = [{ tool: "get_maintenance_ticket_summary", arguments: { propertyId: a }, reason: a }]; }],
  ["claim value", "other_output_field", (d, a) => { d.factualClaims = [{ value: a, evidenceIds: [] }]; }],
  ["future field", "other_output_field", (d, a) => { d.future = { text: a }; }],
];
for (const [label, location, mutate] of textFields) test(`real output traversal: alias in ${label} -> ${location}`, () => {
  const context = bound(), d = decision(); mutate(d, context.alias);
  failure(d, context, safe("model_alias_in_free_text", location));
});

test("reference decode identifies argument, entity and both evidence positions without recording values", () => {
  const context = bound();
  const cases = [
    ["tool_argument", { proposedToolCalls: [{ tool: "resolve_contact_identity", arguments: { respondContactId: context.alias } }] }],
    ["resolved_entity", { resolvedEntities: [{ entityType: "contract", internalId: context.alias }] }],
    ["factual_claim_evidence", { factualClaims: [{ evidenceIds: [context.alias] }] }],
    ["verified_fact_reference", { conversationalResponseParts: { verifiedFactReferences: [context.alias] } }],
  ];
  for (const [location, d] of cases) failure(d, context, safe("model_reference_type_mismatch", location, "output_reference_decode"));
});

test("wrong position and missing/non-issued references retain the original guards", () => {
  const context = bound();
  failure({ proposedToolCalls: [{ tool: "get_service_period_status", arguments: { serviceType: context.alias } }] }, context,
    safe("model_reference_wrong_position", "tool_argument", "output_reference_decode"));
  failure({ factualClaims: [{ evidenceIds: ["not-issued"] }] }, context,
    safe("unaliased_reference_field", "factual_claim_evidence"));
  failure({ factualClaims: [{ evidenceIds: [null] }] }, context,
    safe("unissued_or_raw_model_reference", "factual_claim_evidence", "output_reference_decode"));
  for (const alias of ["ref_invented_1", bound().alias]) {
    failure({ summary: alias }, context, safe("unissued_model_reference", "summary"));
  }
  assert.throws(() => decodeModelDecisionReferences({}, {}), (error) => {
    assert.deepEqual(projectOutputPrivacyFailure(error), safe("missing_model_privacy_scope", "other_output_field", "output_reference_decode")); return true;
  });
});

for (const [label, value] of Object.entries({ uuid: rawId, phone: "+52 222 123 4567", email: "persona@example.com", account: "CLABE 012345678901234567", secret: "sk-ant-syntheticSecret123456" })) {
  test(`residual ${label}: same rejection reason, only fixed location leaves the boundary`, () => {
    const context = bound(), d = { contextAssessment: value };
    const check = verifyFinalModelPayload(d, { scope: context.scope });
    assert.equal(check.allowed, false);
    failure(d, context, safe(check.reasons[0], "context_assessment"));
  });
}

test("unknown/dynamic keys and nested JSON never become diagnostic paths", () => {
  const context = bound();
  for (const d of [{ [rawId]: true }, { future: { [rawId]: "dato" } }, { summary: JSON.stringify({ [rawId]: true }) }]) {
    const checked = verifyFinalModelPayload(d, { scope: context.scope });
    assert.ok(checked.reasons.includes("residual_uuid"));
    failure(d, context, safe(checked.reasons[0], Object.hasOwn(d, "summary") ? "summary" : "other_output_field"));
  }
});

test("reduced adapter uses the same output diagnostic, while valid aliases still decode unchanged", () => {
  const context = bound(), d = decision(); d.summary = context.alias;
  assert.throws(() => decodeReducedShadowAiDecision(d, context.result), (error) => {
    assert.deepEqual(projectOutputPrivacyFailure(error), safe("model_alias_in_free_text", "summary")); return true;
  });
  d.summary = "Consulta";
  d.proposedToolCalls = [{ tool: "get_maintenance_ticket_summary", arguments: [{ key: "propertyId", value: context.alias }], reason: "Consultar estado" }];
  assert.equal(decodeReducedShadowAiDecision(d, context.result).proposedToolCalls[0].arguments.propertyId, rawId);
});

test("legacy generic errors and transport PASS never imply an output reason", () => {
  const legacy = { outputStage: "final_model_privacy", diagnosticCode: "pre_model_sanitization_blocked", truncatedFields: [] };
  assert.deepEqual(reprojectOutputPrivacyDiagnostics({ ...legacy, outputPrivacy: safe("residual_uuid", "summary").outputPrivacy, path: sensitive }), legacy);
  assert.equal(sanitizedOutputPrivacyDiagnostics(legacy), null);
  assert.equal(sanitizedOutputPrivacyDiagnostics({ final_payload_verified: true, serialized_body_verified: true, provider_invoked: true }), null);
});
