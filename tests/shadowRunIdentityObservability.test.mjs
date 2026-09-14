import assert from "node:assert/strict";
import test from "node:test";
import { buildShadowRunIdentityObservability } from "../lib/shadow/runIdentityObservability.js";
import { exactPhoneCandidateRef } from "../lib/shadow/exactPhoneReadOnlyEvaluator.js";

const identityTool = ({ identityId = "identity-1", linkId, status = "confirmed", source = "exact_phone_unique" } = {}) => ({
  name: "resolve_contact_identity", ok: true, result: [
    { entityType: "contact_identity", internalId: identityId, linkId, status, resolved: true, linkSource: source, roles: ["tenant"] },
    { entityType: "property", internalId: "property-1", method: "confirmed_identity_link" },
    { entityType: "contract", internalId: "contract-1", propertyId: "property-1", method: "confirmed_identity_link", active: true },
  ],
});

const run = (id, tool_results_json) => ({ id, created_at: "2026-09-14T12:00:00.000Z", tool_results_json });
const action = (id, values = {}) => ({ ai_run_id: id, conversation_action: "acknowledge_received_information", blocked_reason: null, requires_human: false, auto_send_eligible: true, ...values });

test("atribuye un run 7/7 desde la evidencia realmente usada", () => {
  const linkId = "94f7408e-914f-44ce-b392-2d3224173e79";
  const candidateRef = exactPhoneCandidateRef(linkId);
  const result = buildShadowRunIdentityObservability({ runs: [run("run-1", [identityTool({ linkId })])], actions: [action("run-1")], cohortRefs: [candidateRef] })[0];
  assert.equal(result.identityState, "confirmed");
  assert.equal(result.inExactPhone7of7, true);
  assert.equal(result.exactPhone7of7Ref, candidateRef);
  assert.equal(result.propertyResolved, true);
  assert.equal(result.relationshipResolved, true);
});

test("identidad confirmada fuera de 7/7 no se marca como cohorte", () => {
  const result = buildShadowRunIdentityObservability({ runs: [run("run-2", [identityTool({ linkId: "00000000-0000-4000-8000-000000000001" })])] })[0];
  assert.equal(result.identityState, "confirmed");
  assert.equal(result.inExactPhone7of7, false);
  assert.equal(result.exactPhone7of7Ref, null);
});

test("run sin evidencia de identidad queda unattributed sin inferencia retrospectiva", () => {
  const result = buildShadowRunIdentityObservability({ runs: [run("run-3", [])] })[0];
  assert.equal(result.attribution, "unattributed");
  assert.equal(result.identityState, "unresolved");
  assert.equal(result.attributionReason, "resolution_evidence_missing");
});

test("evidencia explícita unresolved permanece unattributed", () => {
  const unresolved = { name: "resolve_contact_identity", ok: true, result: [{ entityType: "contact_identity", internalId: "respond-contact", status: "identity_not_confirmed", resolved: false }] };
  const result = buildShadowRunIdentityObservability({ runs: [run("run-unresolved", [unresolved])] })[0];
  assert.equal(result.attribution, "unattributed");
  assert.equal(result.attributionReason, "identity_unresolved");
  assert.equal(result.canonicalIdentityRef, null);
});

test("usa la acción final más reciente sin modificarla", () => {
  const newest = action("run-5", { conversation_action: "human_handoff", requires_human: true, auto_send_eligible: false, blocked_reason: "human_required" });
  const older = action("run-5", { conversation_action: "acknowledge_received_information" });
  const result = buildShadowRunIdentityObservability({ runs: [run("run-5", [])], actions: [newest, older] })[0];
  assert.equal(result.action3B, "human_handoff");
  assert.equal(result.blocker, "human_required");
});

test("rondas repetidas con la misma resolución no crean ambigüedad artificial", () => {
  const repeated = identityTool({ linkId: "00000000-0000-4000-8000-000000000003" });
  const result = buildShadowRunIdentityObservability({ runs: [run("run-repeat", [repeated, repeated])] })[0];
  assert.equal(result.attribution, "attributed");
  assert.equal(result.relationshipResolved, true);
});

test("la proyección no expone PII y no altera resultados funcionales", () => {
  const original = action("run-4", { requires_human: true, auto_send_eligible: false, blocked_reason: "insufficient_property_context" });
  const result = buildShadowRunIdentityObservability({ runs: [run("run-4", [{ ...identityTool({ linkId: "00000000-0000-4000-8000-000000000002" }), result: [...identityTool({ linkId: "00000000-0000-4000-8000-000000000002" }).result, { name: "Persona Real", phone: "+521234567890", email: "persona@example.com" }] }])], actions: [original] })[0];
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /Persona Real|1234567890|persona@example\.com|identity-1|property-1|contract-1/);
  assert.equal(result.requiresHuman, true);
  assert.equal(result.autoSendEligible, false);
  assert.equal(result.blocker, "insufficient_property_context");
  assert.equal(original.requires_human, true);
});
