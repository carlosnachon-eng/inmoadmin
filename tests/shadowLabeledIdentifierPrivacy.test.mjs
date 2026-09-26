import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePreModelInput, verifyPreModelPayload } from "../lib/shadow/ai/preModelSanitizer.js";
import { createModelPrivacyScope, bindVerifiedModelMessages, bindModelResult, verifyFinalModelPayload } from "../lib/shadow/ai/finalModelPrivacy.js";
import { decodeReducedShadowAiDecision } from "../lib/shadow/ai/reducedOutputSchema.js";
import { projectOutputPrivacyFailure } from "../lib/shadow/ai/outputPrivacyDiagnostics.js";
import { executeHistoricalReplayCase } from "../lib/shadow/ai/historicalReplay.js";

// Synthetic text only. No provider, database, real case or network access.
const normalPhrases = [
  "solicitar referencia para identificar el caso",
  "pedir referencia antes de continuar",
  "requiere autorización para devolución",
  "la cuenta como antecedente administrativo",
  "referencia no disponible",
  "requiere autorización previa",
  "pedir referencia numérica antes de continuar",
  "solicitar referencia para el caso de 2026",
];
const identifiers = [
  ["referencia: AB1234", "AB1234"],
  ["folio 928374", "928374"],
  ["operación #A12993", "A12993"],
  ["autorización 873421", "873421"],
  ["cuenta 1234567890", "1234567890"],
  ["CLABE 012345678901234567", "012345678901234567"],
  ["tarjeta 4111 1111 1111 1111", "4111 1111 1111 1111"],
  ["referencia: ABCD", "ABCD"],
  ["folio #ABCD", "ABCD"],
  ["referencia no. ABCD", "ABCD"],
  ["folio no 928374", "928374"],
  ["referencia número ABCD", "ABCD"],
  ["referencia núm. ABCD", "ABCD"],
  ["referencia numero: ABCD", "ABCD"],
  ["referencia num. #ABCD", "ABCD"],
  ["referencia AB-1234", "AB-1234"],
  ["referencia ab/1234", "ab/1234"],
  ["referencia ABC1", "ABC1"],
  ["referencia 1ABC", "1ABC"],
  ["folio928374", "928374"],
  ["OPERACION #A12993", "A12993"],
  ["rastreo ZX.7788", "ZX.7788"],
  ["cuenta: ABCD", "ABCD"],
  ["token: ABCD", "ABCD"],
  ["api key: ABCD", "ABCD"],
];
function modelResult() {
  const scope = createModelPrivacyScope();
  return bindModelResult({}, bindVerifiedModelMessages([{ role: "user", content: "Consulta" }], scope));
}
function decision(proposedAction) {
  return { intent: "mantenimiento", secondaryIntents: [], urgency: "normal", summary: "Consulta",
    entitiesMentioned: [], resolvedEntities: [], entityResolutionStatus: "unresolved", informationNeeded: [], proposedToolCalls: [],
    contextAssessment: "Contexto disponible", proposedAction, factualClaims: [],
    conversationalResponseParts: { acknowledgement: "Entiendo.", verifiedFactReferences: [], clarificationQuestion: null, escalationMessage: null },
    executionCommitment: "none", confidence: .8, requiresHuman: true, escalationReason: "Revisión", safetyFlags: [] };
}

for (const text of normalPhrases) {
  test(`ordinary language stays intact at input and output: ${text}`, () => {
    const input = sanitizePreModelInput({ text });
    assert.equal(input.allowed, true);
    assert.deepEqual(input.payload, { message: text });
    assert.deepEqual(input.replacements, {});
    assert.deepEqual(verifyPreModelPayload({ message: text }), { allowed: true, reasons: [] });
    assert.deepEqual(verifyFinalModelPayload({ proposedAction: text }), { allowed: true, reasons: [] });
    const original = decision(text);
    assert.deepEqual(decodeReducedShadowAiDecision(original, modelResult()), original);
  });
}

for (const [text, value] of identifiers) {
  test(`real ID signal remains fail-closed: ${text}`, () => {
    assert.ok(verifyPreModelPayload({ message: text }).reasons.includes("residual_labeled_identifier"));
    const checked = verifyFinalModelPayload({ proposedAction: text });
    assert.equal(checked.allowed, false);
    const sanitized = sanitizePreModelInput({ text });
    if (sanitized.allowed) {
      assert.ok(!sanitized.payload.message.includes(value));
      assert.equal(verifyPreModelPayload(sanitized.payload).allowed, true);
    } else assert.equal(sanitized.payload, null);
    assert.throws(() => decodeReducedShadowAiDecision(decision(text), modelResult()), (error) => {
      assert.deepEqual(projectOutputPrivacyFailure(error), {
        outputStage: "output_privacy_validation",
        outputPrivacy: { reason: checked.reasons[0], location: "proposed_action" },
      });
      assert.ok(!JSON.stringify(projectOutputPrivacyFailure(error)).includes(value));
      return true;
    });
  });
}

test("multiple matches and repeated calls do not leak global-regexp state or eat surrounding prose", () => {
  const text = "pedir referencia antes de continuar; folio 928374; operación #A12993; solicitar referencia para identificar el caso";
  for (let i = 0; i < 3; i++) {
    const result = sanitizePreModelInput({ text });
    assert.equal(result.allowed, true);
    assert.equal(result.replacements.folio, 2);
    assert.ok(result.payload.message.startsWith("pedir referencia antes de continuar;"));
    assert.ok(result.payload.message.endsWith("solicitar referencia para identificar el caso"));
    assert.doesNotMatch(result.payload.message, /928374|A12993/);
    assert.equal(verifyPreModelPayload({ message: text }).allowed, false);
    assert.equal(verifyPreModelPayload(result.payload).allowed, true);
  }
});

test("unlabeled financial values and other private data remain blocked independently", () => {
  for (const text of ["012345678901234567", "4111 1111 1111 1111", "+52 222 123 4567", "persona@example.com",
    "a1100000-0000-4000-8000-000000000001", "sk-ant-syntheticSecret123456", "ref_invented_99"]) {
    assert.equal(verifyFinalModelPayload({ proposedAction: text }).allowed, false);
    assert.throws(() => decodeReducedShadowAiDecision(decision(text), modelResult()), /pre_model_sanitization_blocked/);
  }
});

test("synthetic reduced Replay completes with ordinary proposed_action; financial review is not relaxed", async () => {
  const replayCase = { evaluationMode: "historical_replay", sufficientHistoricalContext: true,
    temporalGrounding: "current_state", identityGrounding: "current_canonical_mapping",
    envelope: { provider: "respond_admin", direction: "inbound", sanitizedText: "¿Cuándo se devuelve el depósito?", providerMetadata: {} } };
  const env = { SHADOW_HISTORICAL_REPLAY_ENABLED: "true", SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED: "true",
    SHADOW_AI_OUTPUT_MODE: "anthropic_json_schema", ANTHROPIC_API_KEY: "synthetic-only",
    SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED: "false", SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED: "false",
    SHADOW_IDENTITY_CONFIRMATION_ENABLED: "false", SHADOW_ADMIN_OUTBOUND_ENABLED: "false",
    SHADOW_OUTBOUND_ENABLED: "false", SHADOW_ADMIN_WORK_R1_ENABLED: "false", SHADOW_ADMIN_OUTBOUND_CANARY_ENABLED: "false" };
  const run = async (proposedAction) => {
    let calls = 0;
    const result = await executeHistoricalReplayCase({}, replayCase, { env, useReducedOutputSchema: true, now: () => 1000,
      fetchImpl: async () => {
        calls++;
        return { ok: true, json: async () => ({ id: "synthetic-request", model: "claude-haiku-4-5-20251001",
          content: [{ type: "text", text: JSON.stringify({ ...decision(proposedAction), intent: "pago_renta" }) }],
          usage: { input_tokens: 5, output_tokens: 2 } }) };
      }, executeTool: () => assert.fail("no tools requested in this synthetic decision"),
    });
    assert.equal(calls, 1);
    assert.deepEqual(result.tools, []);
    assert.deepEqual(result.privacyChecks, [{ final_payload_verified: true, serialized_body_verified: true,
      output_mode: "anthropic_json_schema", privacy_stage: "final_model_privacy", provider_invoked: true }]);
    assert.equal(result.conversationAction.requires_human, true);
    assert.equal(result.conversationAction.auto_send_eligible, false);
    return result;
  };
  const baseline = await run("Escalar");
  for (const text of normalPhrases.slice(0, 4)) {
    const result = await run(text);
    assert.deepEqual(result.conversationAction, baseline.conversationAction);
  }
  let calls = 0, tools = 0;
  await assert.rejects(executeHistoricalReplayCase({}, replayCase, { env, useReducedOutputSchema: true,
    fetchImpl: async () => { calls++; return { ok: true, json: async () => ({
      content: [{ type: "text", text: JSON.stringify(decision("referencia: AB1234")) }], usage: { input_tokens: 5, output_tokens: 2 },
    }) }; }, executeTool: () => { tools++; },
  }), (error) => {
    assert.deepEqual(projectOutputPrivacyFailure(error), { outputStage: "output_privacy_validation",
      outputPrivacy: { reason: "residual_labeled_identifier", location: "proposed_action" } });
    return true;
  });
  assert.equal(calls, 1); assert.equal(tools, 0);
});
