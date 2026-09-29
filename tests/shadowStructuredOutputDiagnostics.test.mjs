import test from "node:test";
import assert from "node:assert/strict";
import { decodeReducedShadowAiDecision } from "../lib/shadow/ai/reducedOutputSchema.js";
import { READ_ONLY_SHADOW_TOOLS, SHADOW_TOOL_ARGUMENT_SCHEMAS } from "../lib/shadow/context.js";
import { createModelPrivacyScope, bindVerifiedModelMessages, bindModelResult } from "../lib/shadow/ai/finalModelPrivacy.js";
import { projectStructuredOutputFailure, sanitizedStructuredOutputDiagnostics, reprojectStructuredOutputDiagnostics } from "../lib/shadow/ai/structuredOutputDiagnostics.js";

const code = "reduced_arguments_key_not_allowed_for_tool";
const base = { outputStage: "structured_validation", diagnosticCode: code };
const safe = (tool = "resolve_contact_identity", argument_key = "propertyId") => ({ ...base, structuredOutput: { tool, argument_key } });
const sensitive = "ref_abcdefghijklmnopqrstuvwxyzabcdef_1 11000000-0000-4000-8000-000000000001 ana@example.com +52 222 123 4567 032180000118359719 sk-ant-synthetic-private";
const decision = (tool, key, value) => ({ intent: "mantenimiento", secondaryIntents: [], urgency: "normal", summary: "Consulta",
  entitiesMentioned: [], resolvedEntities: [], entityResolutionStatus: "unresolved", informationNeeded: [],
  proposedToolCalls: [{ tool, arguments: [{ key, value }], reason: "Consultar estado" }], contextAssessment: "Contexto disponible",
  proposedAction: "Escalar", factualClaims: [], conversationalResponseParts: { acknowledgement: "Entiendo.", verifiedFactReferences: [], clarificationQuestion: null, escalationMessage: null },
  executionCommitment: "none", confidence: .8, requiresHuman: true, escalationReason: "Revisión", safetyFlags: [] });
function rejected(tool, key, value = sensitive) {
  let error;
  try { decodeReducedShadowAiDecision(decision(tool, key, value), {}); } catch (caught) { error = caught; }
  assert.ok(error); return error;
}
const noSensitive = (value) => assert.doesNotMatch(JSON.stringify(value), /ref_|11000000|ana@example|222 123|032180|sk-ant|private_value/);

for (const tool of READ_ONLY_SHADOW_TOOLS) test(`known wrong-tool keys remain rejected, projected only as enums: ${tool}`, () => {
  const keys = [...new Set(Object.values(SHADOW_TOOL_ARGUMENT_SCHEMAS).flatMap(s => Object.keys(s.properties)))];
  for (const key of keys.filter(k => !Object.hasOwn(SHADOW_TOOL_ARGUMENT_SCHEMAS[tool].properties, k))) {
    const error = rejected(tool, key);
    assert.equal(error.message, `invalid_structured_output:${code}`);
    assert.equal(error.diagnosticCode, code);
    assert.equal(error.outputStage, "structured_validation");
    assert.deepEqual(projectStructuredOutputFailure(error), safe(tool, key));
    noSensitive({ message: error.message, error, receipt: projectStructuredOutputFailure(error) });
    assert.equal(Object.hasOwn(error, "structuredOutput"), false); // no unprojected fields on the exception
  }
});

for (const key of [sensitive, "unknown_key", "__proto__", "constructor", null, 7, { value: sensitive }]) {
  test(`unknown/non-string key is not echoed (${typeof key})`, () => {
    const error = rejected("resolve_contact_identity", key);
    assert.equal(error.diagnosticCode, code);
    assert.deepEqual(projectStructuredOutputFailure(error), base);
    noSensitive({ error, receipt: projectStructuredOutputFailure(error) });
  });
}

test("unknown tool keeps the old tool error and cannot produce structural metadata", () => {
  const error = rejected(sensitive, "propertyId");
  assert.equal(error.diagnosticCode, "reduced_arguments_tool");
  assert.equal(projectStructuredOutputFailure(error), null);
  noSensitive(error);
});

test("error properties cannot forge a decoder receipt", () => {
  const error = Object.assign(new Error("synthetic"), safe());
  assert.equal(projectStructuredOutputFailure(error), null);
});

test("projection strips values, aliases, arguments, raw paths and model text", () => {
  const contaminated = { ...safe(), message: sensitive, body: sensitive, path: sensitive, truncatedFields: [sensitive],
    structuredOutput: { ...safe().structuredOutput, value: sensitive, alias: sensitive, arguments: [{ key: "propertyId", value: sensitive }], expected_reference_type: sensitive } };
  for (const project of [sanitizedStructuredOutputDiagnostics, reprojectStructuredOutputDiagnostics]) {
    assert.deepEqual(project(contaminated), safe()); noSensitive(project(contaminated));
  }
});

for (const detail of [undefined, {}, { tool: sensitive, argument_key: "propertyId" }, { tool: "resolve_contact_identity", argument_key: sensitive },
  { tool: "resolve_contact_identity", argument_key: "respondContactId" }]) {
  test("unknown, incomplete, legacy or valid-for-tool detail does not get projected", () => {
    assert.deepEqual(sanitizedStructuredOutputDiagnostics({ ...base, structuredOutput: detail }), base);
  });
}

test("other reasons/stages cannot acquire tool/key; legacy rows remain unchanged", () => {
  for (const legacy of [{ outputStage: "structured_validation", diagnosticCode: "reduced_arguments_shape" },
    { outputStage: "output_reference_decode", diagnosticCode: code }, { diagnosticCode: code }, {}]) {
    const input = { ...legacy, structuredOutput: safe().structuredOutput };
    assert.equal(sanitizedStructuredOutputDiagnostics(input), null);
    assert.deepEqual(reprojectStructuredOutputDiagnostics(input), legacy);
  }
  assert.deepEqual(reprojectStructuredOutputDiagnostics(base), base);
  assert.equal(sanitizedStructuredOutputDiagnostics(null), null);
});

test("valid tool/key and issued reference still decode server-side with no diagnostic", () => {
  const scope = createModelPrivacyScope(); const internal = "synthetic-contact";
  const alias = scope.reference(internal, "respond_contact");
  const messages = bindVerifiedModelMessages([{ role: "user", content: "Consulta" }], scope);
  const result = bindModelResult({ text: "synthetic" }, messages);
  const decoded = decodeReducedShadowAiDecision(decision("resolve_contact_identity", "respondContactId", alias), result);
  assert.deepEqual(decoded.proposedToolCalls[0].arguments, { respondContactId: internal });
  assert.equal(projectStructuredOutputFailure(result), null);
});
