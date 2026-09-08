import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildAllowlistedShadowAiContext,
  invokeShadowPhase3A,
  invokeShadowPhase3ARepair,
} from "../lib/shadow/ai/phase3AGateway.js";

const original = "Hola Carlos Perez, escribe a carlos@example.com sobre Calle Reforma 123.";
const envelope = {
  sanitizedText: original,
  providerMetadata: {
    contactRole: "tenant",
    propertyId: "f2a30000-0000-4000-8400-000000000001",
    arbitrarySecret: "must-not-cross",
    priorConversation: [{ direction: "outbound_human", actor: "emporio_human", sanitizedText: "Contacta a Ana Lopez al 2221234567" }],
    attachmentContext: { present: true, interpreted: true, arbitrary: "drop", items: [{ type: "image", mimeType: "image/jpeg", sourceMessageId: "drop", interpretation: { interpretationStatus: "completed", category: "possible_payment_receipt", summary: "Comprobante de Ana Lopez por $1,250", extractedFields: { amount: 1250, currency: "MXN", account_last4: "1234", reference: "ABC-9876" }, requiresHumanReview: true, arbitrary: "drop" } }] },
  },
};
const deterministic = { intent: "mantenimiento", interactionDirection: "inbound_customer_action", requiresHuman: true, reasonCodes: ["identity_required"] };

const parsedUserContext = (messages) => JSON.parse(messages.find((item) => item.role === "user").content);

test("gateway entrega al modelCall sólo texto conversacional sanitizado y contexto allowlisted", async () => {
  let received;
  const result = await invokeShadowPhase3A({
    envelope, deterministic, systemPrompt: "system", toolGuide: "tools",
    modelCall: async (messages) => { received = messages; return { text: "{}" }; },
  });
  assert.equal(result.text, "{}");
  const context = parsedUserContext(received);
  assert.doesNotMatch(JSON.stringify(context), /Carlos Perez|carlos@example\.com|Reforma 123|2221234567|Ana Lopez|must-not-cross|sourceMessageId/);
  assert.match(context.message, /\[PERSONA\].*\[EMAIL\].*\[DOMICILIO\]/);
  assert.equal(context.metadata.propertyId, "f2a30000-0000-4000-8400-000000000001");
  assert.deepEqual(context.metadata.attachmentContext.items[0].interpretation.extractedFields, { amount: 1250, currency: "MXN" });
  assert.deepEqual(Object.keys(context.metadata).sort(), ["attachmentContext", "contactRole", "priorConversation", "propertyId"]);
});

test("sanitizer o verificador fallido produce cero model calls", async () => {
  let calls = 0;
  await assert.rejects(() => invokeShadowPhase3A({
    envelope: { sanitizedText: "" }, deterministic, systemPrompt: "system", toolGuide: "tools",
    modelCall: async () => { calls += 1; },
  }), /pre_model_sanitization_blocked/);
  assert.equal(calls, 0);
});

test("primera y segunda ronda reciben la misma sanitización y conservan tools/evidence ledger", async () => {
  const tools = [{
    name: "get_payment_summary", args: { contractId: "f2a30000-0000-4000-8400-000000000002", injected: "drop" }, ok: true, error: null,
    result: [{ entityType: "payment", internalId: "f2a30000-0000-4000-8400-000000000003", status: "pendiente", period: "2026-09-01", amount: 1200, href: "https://internal.invalid", arbitrary: "drop" }],
  }];
  const contexts = [];
  for (const round of [0, 1]) await invokeShadowPhase3A({
    envelope, deterministic, toolResults: tools, round, systemPrompt: "system", toolGuide: "tools",
    modelCall: async (messages) => { contexts.push(parsedUserContext(messages)); return { text: "{}" }; },
  });
  assert.equal(contexts[0].message, contexts[1].message);
  assert.equal(contexts[1].round, 2);
  assert.deepEqual(contexts[1].tools[0].args, { contractId: "f2a30000-0000-4000-8400-000000000002" });
  assert.equal(contexts[1].tools[0].result[0].amount, 1200);
  assert.equal(contexts[1].evidenceLedger[0].facts.amount, 1200);
  assert.doesNotMatch(JSON.stringify(contexts[1]), /internal\.invalid|arbitrary|injected/);
});

test("repair sólo se invoca con salida verificable y falla cerrado ante residual", async () => {
  let calls = 0;
  const safe = await invokeShadowPhase3ARepair('{"intent":"mantenimiento"}', { repairModelCall: async (value) => { calls += 1; return { text: value }; } });
  assert.equal(safe.text, '{"intent":"mantenimiento"}');
  await assert.rejects(() => invokeShadowPhase3ARepair('{"email":"persona@example.com"}', { repairModelCall: async () => { calls += 1; } }), /pre_model_sanitization_blocked/);
  assert.equal(calls, 1);
});

test("context builder rechaza un message que no pasó el verificador", () => {
  assert.throws(() => buildAllowlistedShadowAiContext({ envelope, deterministic, message: "persona@example.com" }), /pre_model_sanitization_blocked/);
});

test("arquitectura: runner, state machine y replay no acceden al transporte fuera del gateway", () => {
  for (const file of ["runner.js", "stateMachine.js", "historicalReplay.js"]) {
    const source = fs.readFileSync(new URL(`../lib/shadow/ai/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /createAnthropicShadow(?:Repair)?Response/);
    assert.match(source, /invokeShadowPhase3A/);
  }
});
