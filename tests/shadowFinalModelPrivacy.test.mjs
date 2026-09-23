import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createModelPrivacyScope, verifyFinalModelPayload, bindVerifiedModelMessages, serializeVerifiedAnthropicBody } from "../lib/shadow/ai/finalModelPrivacy.js";
import { invokeShadowPhase3A, invokeShadowPhase3ARepair, decodeModelDecisionReferences } from "../lib/shadow/ai/phase3AGateway.js";
import { createAnthropicShadowResponse } from "../lib/shadow/ai/anthropic.js";
import { executeShadowReadOnlyTool } from "../lib/shadow/context.js";
import { groundAndRenderDecision } from "../lib/shadow/ai/grounding.js";
import { executeHistoricalReplayCase } from "../lib/shadow/ai/historicalReplay.js";
import { executeAnthropicAttemptPolicy } from "../lib/shadow/ai/stateMachine.js";
import { REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "../lib/shadow/ai/realPrompt.js";

const property = "a1100000-0000-4000-8000-000000000001";
const contract = "a1100000-0000-4000-8000-000000000002";
const payment = "a1100000-0000-4000-8000-000000000003";
const contact = "987654321";
const contactTool = { name: "resolve_contact_identity", args: { respondContactId: contact }, ok: true,
  result: [{ entityType: "contact_identity", internalId: "a1100000-0000-4000-8000-000000000004", resolved: true, status: "confirmed", roles: ["owner"] }] };
const tool = { name: "get_payment_summary", args: { contractId: contract }, ok: true,
  result: [{ entityType: "payment", internalId: payment, status: "pendiente", period: "2026-09", amount: 1200 }] };
const decision = () => ({ intent: "mantenimiento", secondaryIntents: [], urgency: "normal", summary: "Consulta", entitiesMentioned: [], resolvedEntities: [], entityResolutionStatus: "unresolved", informationNeeded: [], proposedToolCalls: [], contextAssessment: "Contexto disponible", proposedAction: "Escalar", factualClaims: [], conversationalResponseParts: { acknowledgement: "Entiendo.", verifiedFactReferences: [], clarificationQuestion: null, escalationMessage: null }, executionCommitment: "none", confidence: .8, requiresHuman: true, escalationReason: "Revisión", safetyFlags: [] });
const invocation = (extra = {}) => ({ envelope: { sanitizedText: "Hola Ana Perez, hay humedad. Mi correo es ana@example.com.", providerMetadata: { propertyId: property, contractId: contract } }, deterministic: { intent: "mantenimiento", requiresHuman: true }, toolResults: [structuredClone(tool), structuredClone(contactTool)], systemPrompt: REAL_SHADOW_AI_SYSTEM_PROMPT, toolGuide: REAL_SHADOW_AI_TOOL_GUIDE, ...extra });
const contextOf = (messages) => JSON.parse(messages[1].content);
const providerResponse = (text) => ({ ok: true, json: async () => ({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 3 } }) });

for (const [name, value] of Object.entries({ uuid: property, uuid_v7: "019abcdef-aaaa-7aaa-aaaa-123456789abc".slice(1), phone: "+52 (222) 123-4567", email: "persona@example.com", account: "CLABE 012345678901234567", card: "4111 1111 1111 1111", secret: "sk-ant-syntheticSecret123456", token: "Bearer token-syntheticAuth123", url: "https://private.example.invalid/customer", name: "Ana Perez", address: "Calle Reforma 123", opaque_id: "payment:internal123" })) {
  test(`recursive final verifier blocks ${name} in every nested surface`, () => {
    for (const payload of [ { message: value }, { metadata: { later: { data: value } } }, { priorConversation: [{ content: value }] }, { tools: [{ args: { extra: value } }] }, { tools: [{ result: [{ later: value }] }] }, { evidenceLedger: [{ facts: { later: value } }] }, { futureField: [{ newField: value }] } ]) {
      assert.equal(verifyFinalModelPayload(payload).allowed, false, name);
    }
  });
}

test("IDs cortos/numéricos en campos de referencia también se rechazan; aliases requieren emisión", () => {
  for (const payload of [{ metadata: { respond_contact_id: contact } }, { later: { propertyId: "p1" } }, { args: { paymentId: 42 } }, { metadata: { propertyIds: ["123"] } }, { message: "ref_invented_1" }]) assert.equal(verifyFinalModelPayload(payload).allowed, false);
});

test("campos nuevos de credenciales/datos personales, refs y URLs no HTTP fallan cerrados", () => {
  for (const field of ["password", "apiKey", "access_token", "phone", "email", "accountNumber", "fullName", "address", "candidateRef"]) {
    assert.equal(verifyFinalModelPayload({ future: { [field]: "unprefixedValue" } }).allowed, false, field);
  }
  for (const value of ["ftp://private.invalid/file", "//private.invalid/file", "41e6ed66d3d1"]) assert.equal(verifyFinalModelPayload({ future: value }).allowed, false);
});

test("el mapa sólo se crea en servidor, nunca en un runtime de navegador", () => {
  const prior = globalThis.window;
  try { globalThis.window = {}; assert.throws(() => createModelPrivacyScope(), /pre_model_sanitization_blocked/); }
  finally { if (prior === undefined) delete globalThis.window; else globalThis.window = prior; }
});

test("serialización no puede ocultar PII mediante toJSON, getters, claves o ciclos", () => {
  for (const payload of [{ toJSON: () => ({ message: "unsafe" }) }, { get hidden() { throw Error("must_not_read"); } }, { [property]: true }, new Date()]) assert.equal(verifyFinalModelPayload(payload).allowed, false);
  const cycle = {}; cycle.self = cycle;
  assert.equal(verifyFinalModelPayload(cycle).allowed, false);
});

test("capture del fetch real: contexto completo anonimizado en ambos modos, sin UUID ni PII", async () => {
  for (const outputMode of ["anthropic_json_schema", "text_json_local"]) {
    let captured; let calls = 0;
    await invokeShadowPhase3A(invocation({ modelOptions: { env: { SHADOW_AI_OUTPUT_MODE: outputMode, ANTHROPIC_API_KEY: "synthetic-only" }, fetchImpl: async (_url, options) => { calls++; captured = options.body; return providerResponse(JSON.stringify(decision())); } } }));
    assert.equal(calls, 1);
    assert.doesNotMatch(captured, /a1100000|987654321|Ana Perez|ana@example.com|synthetic-only/);
    const body = JSON.parse(captured); const context = JSON.parse(body.messages[0].content);
    assert.match(context.metadata.propertyId, /^ref_[a-z]+_\d+$/);
    assert.equal(context.metadata.contractId, context.tools[0].args.contractId);
    assert.equal(context.tools[0].result[0].internalId, context.evidenceLedger[0].subjectId);
    assert.notEqual(context.evidenceLedger[0].subjectId, context.evidenceLedger[0].evidenceId);
    assert.equal(context.evidenceLedger[0].facts.amount, 1200);
    assert.match(context.tools[1].args.respondContactId, /^ref_[a-z]+_\d+$/);
    assert.equal(Boolean(body.output_config), outputMode === "anthropic_json_schema");
  }
});

test("direct transport cannot bypass verification with nested JSON/escaped UUID or appended system PII", async () => {
  let calls = 0; const fetchImpl = async () => { calls++; return providerResponse("{}"); };
  for (const content of [JSON.stringify({ metadata: { propertyId: property } }), JSON.stringify({ tools: [{ result: { arbitrary: property } }] }), '{"message":"\\u0061' + property.slice(1) + '"}']) {
    await assert.rejects(() => createAnthropicShadowResponse([{ role: "user", content }], { env: {}, fetchImpl }), /pre_model_sanitization_blocked/);
  }
  await assert.rejects(() => createAnthropicShadowResponse([{ role: "system", content: `${REAL_SHADOW_AI_SYSTEM_PROMPT}\n\n${REAL_SHADOW_AI_TOOL_GUIDE}\n${property}` }], { env: {}, fetchImpl }), /pre_model_sanitization_blocked/);
  assert.equal(calls, 0);
});

test("campos agregados al body después del gateway se verifican antes de fetch", () => {
  const scope = createModelPrivacyScope();
  const messages = bindVerifiedModelMessages([{ role: "user", content: '{"message":"Hola"}' }], scope);
  assert.throws(() => serializeVerifiedAnthropicBody({ messages, future: { pii: "persona@example.com" } }, messages), /pre_model_sanitization_blocked/);
  assert.throws(() => { messages[0].content = property; }, TypeError);
});

test("una colisión entre referencia y enum/facto falla cerrada, no reescribe decisiones ni facts", async () => {
  let calls = 0;
  for (const propertyReference of ["mantenimiento", "2026-09"]) {
    await assert.rejects(() => invokeShadowPhase3A(invocation({
      envelope: { sanitizedText: "Consulta", providerMetadata: { propertyReference } },
      modelCall: async () => { calls++; },
    })), /pre_model_sanitization_blocked/);
  }
  assert.equal(calls, 0);
  assert.equal(tool.result[0].period, "2026-09"); assert.equal(tool.result[0].amount, 1200);
});

test("referencias necesarias vuelven al ID correcto sólo server-side: tool real + evidence ledger", async () => {
  let sent; let callbackOptions;
  const result = await invokeShadowPhase3A(invocation({ modelCall: async (messages, options) => {
    sent = contextOf(messages); callbackOptions = options;
    const d = decision(); d.resolvedEntities = [{ entityType: "property", internalId: sent.metadata.propertyId, label: "Inmueble" }];
    d.proposedToolCalls = [{ tool: "get_maintenance_ticket_summary", arguments: { propertyId: sent.metadata.propertyId }, reason: "Consultar estado" }, { tool: "resolve_contact_identity", arguments: { respondContactId: sent.tools[1].args.respondContactId }, reason: "Contexto" }];
    d.factualClaims = [{ factType: "payment.status", value: "pendiente", evidenceIds: [sent.evidenceLedger[0].evidenceId] }];
    d.conversationalResponseParts.verifiedFactReferences = [sent.evidenceLedger[0].evidenceId];
    return { text: JSON.stringify(d) };
  } }));
  const decoded = decodeModelDecisionReferences(JSON.parse(result.text), result);
  assert.equal(decoded.resolvedEntities[0].internalId, property);
  assert.equal(decoded.proposedToolCalls[0].arguments.propertyId, property);
  assert.equal(decoded.proposedToolCalls[1].arguments.respondContactId, contact);
  assert.deepEqual(decoded.factualClaims[0].evidenceIds, [`payment:${payment}`]);
  assert.equal(groundAndRenderDecision(decoded, [tool]).groundingStatus, "grounded");
  let queryId;
  const admin = { from(table) { assert.equal(table, "maintenance_tickets"); const q = { select() { return q; }, eq(field, value) { assert.equal(field, "property_id"); queryId = value; return q; }, order() { return q; }, limit: async () => ({ data: [], error: null }) }; return q; } };
  await executeShadowReadOnlyTool(admin, decoded.proposedToolCalls[0].tool, decoded.proposedToolCalls[0].arguments);
  assert.equal(queryId, property);
  assert.doesNotMatch(JSON.stringify([sent, callbackOptions, result]), /a1100000|reverse|internalValues/);
});

test("aliases inventados, de otro tipo/contexto y UUID directo bloquean toda la decisión", async () => {
  let previousAlias;
  const first = await invokeShadowPhase3A(invocation({ modelCall: async (messages) => { previousAlias = contextOf(messages).metadata.propertyId; return { text: "{}" }; } }));
  assert.ok(first);
  for (const invalid of ["ref_invented_1", property, "p1", previousAlias, "wrong_type"]) {
    const result = await invokeShadowPhase3A(invocation({ modelCall: async (messages) => {
      const d = decision(); const context = contextOf(messages);
      d.proposedToolCalls = [{ tool: "get_maintenance_ticket_summary", arguments: { propertyId: invalid === "wrong_type" ? context.metadata.contractId : invalid }, reason: "Consultar" }];
      return { text: JSON.stringify(d) };
    } }));
    assert.throws(() => decodeModelDecisionReferences(JSON.parse(result.text), result), /pre_model_sanitization_blocked/);
  }
});

test("repair conserva el mismo mapa sin reenviar inbound original ni UUID; residual bloquea repair", async () => {
  let context; let fetched;
  const first = await invokeShadowPhase3A(invocation({ modelCall: async (messages) => { context = contextOf(messages); return { text: "{" }; } }));
  const d = decision(); d.proposedToolCalls = [{ tool: "find_active_contracts", arguments: { contractId: context.metadata.contractId }, reason: "Consultar" }];
  const repaired = await invokeShadowPhase3ARepair(JSON.stringify(d), { sourceResult: first, modelOptions: { env: {}, fetchImpl: async (_url, options) => { fetched = options.body; return providerResponse(JSON.stringify(d)); } } });
  assert.equal(decodeModelDecisionReferences(JSON.parse(repaired.text), repaired).proposedToolCalls[0].arguments.contractId, contract);
  assert.doesNotMatch(fetched, /a1100000|Ana Perez|ana@example.com/);
  let repairCalls = 0;
  await assert.rejects(() => invokeShadowPhase3ARepair(`{"extra":"${property}"}`, { sourceResult: first, repairModelCall: async () => { repairCalls++; } }), /pre_model_sanitization_blocked/);
  assert.equal(repairCalls, 0);
});

const replayEnv = { SHADOW_HISTORICAL_REPLAY_ENABLED: "true", SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED: "true", SHADOW_ADMIN_OUTBOUND_ENABLED: "false", SHADOW_OUTBOUND_ENABLED: "false" };
const replayCase = { evaluationMode: "historical_replay", sufficientHistoricalContext: true, envelope: { provider: "respond_admin", sanitizedText: "¿Cómo va el mantenimiento?", providerMetadata: { propertyId: property } } };
test("Replay usa la misma frontera en dos rondas; tool sólo recibe ID interno, sin escrituras", async () => {
  let calls = 0; let toolCalls = 0; const payloads = [];
  const result = await executeHistoricalReplayCase({ from() { throw Error("no database access expected"); } }, replayCase, { env: replayEnv,
    modelCall: async (messages) => {
      calls++; const context = contextOf(messages); payloads.push(context);
      const d = decision();
      if (calls === 1) d.proposedToolCalls = [{ tool: "get_maintenance_ticket_summary", arguments: { propertyId: context.metadata.propertyId }, reason: "Estado" }];
      return { text: JSON.stringify(d), usage: {} };
    }, executeTool: async (_db, name, args) => { toolCalls++; assert.equal(name, "get_maintenance_ticket_summary"); assert.equal(args.propertyId, property); return [{ entityType: "maintenance_ticket", internalId: payment, status: "abierto", priority: "normal" }]; },
  });
  assert.equal(calls, 2); assert.equal(toolCalls, 1);
  assert.notEqual(payloads[0].metadata.propertyId, payloads[1].metadata.propertyId);
  assert.doesNotMatch(JSON.stringify(payloads), /a1100000/);
  assert.equal(typeof result.conversationAction.requires_human, "boolean");
  assert.equal(typeof result.conversationAction.auto_send_eligible, "boolean");
});

test("final verifier FAIL: cero provider calls y cero tools, tampoco retry de privacidad", async () => {
  let modelCalls = 0; let toolCalls = 0;
  const unsafe = { ...replayCase, envelope: { ...replayCase.envelope, providerMetadata: { propertyId: property, subject: "019aaaaa-aaaa-7aaa-aaaa-123456789abc" } } };
  await assert.rejects(() => executeHistoricalReplayCase({}, unsafe, { env: replayEnv, modelCall: async () => { modelCalls++; }, executeTool: async () => { toolCalls++; } }), /pre_model_sanitization_blocked/);
  assert.equal(modelCalls, 0); assert.equal(toolCalls, 0);
  let attempts = 0;
  await assert.rejects(() => executeAnthropicAttemptPolicy({ call: async () => { attempts++; return invokeShadowPhase3A({ ...invocation(), envelope: unsafe.envelope }); }, clock: { now: Date.now, setTimeout, clearTimeout }, deadlineMs: Date.now() + 120000, attemptTimeoutMs: 40000, minimumRetryBudgetMs: 42000, round: 1, telemetry: { anthropic_requests: [] } }), /pre_model_sanitization_blocked/);
  assert.equal(attempts, 1);
});

test("modelo devuelve UUID en Replay: cero herramientas, sin segundo caso ni segunda ronda", async () => {
  let modelCalls = 0; let toolCalls = 0;
  await assert.rejects(() => executeHistoricalReplayCase({}, replayCase, { env: replayEnv, modelCall: async () => { modelCalls++; const d = decision(); d.proposedToolCalls = [{ tool: "get_maintenance_ticket_summary", arguments: { propertyId: property }, reason: "Consultar" }]; return { text: JSON.stringify(d), usage: {} }; }, executeTool: async () => { toolCalls++; } }), /pre_model_sanitization_blocked/);
  assert.equal(modelCalls, 1); assert.equal(toolCalls, 0);
});

test("arquitectura: decode antes de plan/tools en los tres ejecutores; fetch usa sólo body verificado", () => {
  for (const file of ["runner.js", "stateMachine.js", "historicalReplay.js"]) {
    const source = fs.readFileSync(new URL(`../lib/shadow/ai/${file}`, import.meta.url), "utf8");
    const decode = source.indexOf("decodeModelDecisionReferences(");
    const tools = source.indexOf("validateShadowToolArguments(", decode);
    assert.ok(decode >= 0); assert.ok(tools > decode);
    assert.doesNotMatch(source, /createAnthropicShadow(?:Repair)?Response/);
  }
  const source = fs.readFileSync(new URL("../lib/shadow/ai/anthropic.js", import.meta.url), "utf8");
  assert.ok(source.indexOf("serializeVerifiedAnthropicBody(body, messages)") < source.indexOf("await fetchImpl("));
  assert.match(source, /body: serializedBody/);
});
