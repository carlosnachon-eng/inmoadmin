import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReducedAnthropicDecisionSchema, decodeReducedShadowAiDecision, measureOutputSchema } from "../lib/shadow/ai/reducedOutputSchema.js";
import { anthropicShadowAiDecisionJsonSchema, validateShadowAiDecision } from "../lib/shadow/ai/schema.js";
import { READ_ONLY_SHADOW_TOOLS, SHADOW_TOOL_ARGUMENT_SCHEMAS, validateShadowToolArguments, executeShadowReadOnlyTool } from "../lib/shadow/context.js";
import { createModelPrivacyScope, modelReferenceType, bindVerifiedModelMessages, bindModelResult, decodeModelDecisionReferences, serializeVerifiedAnthropicBody } from "../lib/shadow/ai/finalModelPrivacy.js";
import { invokeShadowPhase3A } from "../lib/shadow/ai/phase3AGateway.js";
import { finalizeShadowAiDecision } from "../lib/shadow/ai/runner.js";
import { buildShadowOperationalResolution } from "../lib/shadow/ai/operationalResolution.js";
import { buildConversationAction, SHADOW_CONVERSATION_DOMAINS } from "../lib/shadow/ai/conversationAction.js";
import { REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "../lib/shadow/ai/realPrompt.js";

const decision = () => ({ intent: "mantenimiento", secondaryIntents: [], urgency: "normal", summary: "Consulta",
  entitiesMentioned: [], resolvedEntities: [], entityResolutionStatus: "unresolved", informationNeeded: [], proposedToolCalls: [],
  contextAssessment: "Contexto disponible", proposedAction: "Escalar", factualClaims: [],
  conversationalResponseParts: { acknowledgement: "Entiendo.", verifiedFactReferences: [], clarificationQuestion: null, escalationMessage: null },
  executionCommitment: "none", confidence: .8, requiresHuman: true, escalationReason: "Revisión", safetyFlags: [] });
const keys = Object.keys(anthropicShadowAiDecisionJsonSchema.properties.proposedToolCalls.items.properties.arguments.properties);
const rawValue = (key) => ({ period: "2026-09", serviceType: "agua", domain: "maintenance", status: "pending", sourceType: "contract",
  respondContactId: "synthetic-contact", propertyReference: "synthetic-unit", contextKey: "synthetic-work" }[key]
  || `b0000000-0000-4000-8000-${String(keys.indexOf(key) + 1).padStart(12, "0")}`);
const wire = (d) => ({ ...structuredClone(d), proposedToolCalls: d.proposedToolCalls.map((call) => ({ ...call,
  arguments: Object.entries(call.arguments).map(([key, value]) => ({ key, value })) })) });
const callDecision = (tool, args) => ({ ...decision(), proposedToolCalls: [{ tool, arguments: args, reason: "Consultar estado" }] });
function boundContext(rawArgs, tool, typeOverride = {}) {
  const scope = createModelPrivacyScope();
  const args = Object.fromEntries(Object.entries(rawArgs).map(([key, value]) => {
    const type = typeOverride[key] || modelReferenceType(key, rawArgs, tool);
    return [key, type ? scope.reference(value, type) : value];
  }));
  const messages = bindVerifiedModelMessages([{ role: "user", content: JSON.stringify({ message: "Consulta", metadata: args }) }], scope);
  return { args, scope, messages, result: bindModelResult({ text: "synthetic" }, messages) };
}
function normalDecode(d, result) {
  const decoded = decodeModelDecisionReferences(validateShadowAiDecision(structuredClone(d)), result);
  for (const call of decoded.proposedToolCalls) call.arguments = validateShadowToolArguments(call.tool, call.arguments);
  return decoded;
}

test("schema diff is only the arguments representation; production constant is not mutated", () => {
  const before = JSON.stringify(anthropicShadowAiDecisionJsonSchema);
  const reduced = buildReducedAnthropicDecisionSchema();
  const pairs = reduced.properties.proposedToolCalls.items.properties.arguments;
  assert.deepEqual(pairs, { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "value"],
    properties: { key: { type: "string", enum: keys }, value: { type: "string" } } } });
  assert.deepEqual(reduced.properties.proposedToolCalls.items.properties.tool.enum, READ_ONLY_SHADOW_TOOLS);
  reduced.properties.proposedToolCalls.items.properties.arguments = structuredClone(anthropicShadowAiDecisionJsonSchema.properties.proposedToolCalls.items.properties.arguments);
  assert.deepEqual(reduced, anthropicShadowAiDecisionJsonSchema);
  reduced.properties.intent.enum.push("local-only");
  assert.equal(JSON.stringify(anthropicShadowAiDecisionJsonSchema), before);
});

test("objective metrics: no optional argument subsets, same unions, one extra array level", () => {
  const before = measureOutputSchema(anthropicShadowAiDecisionJsonSchema);
  const after = measureOutputSchema(buildReducedAnthropicDecisionSchema());
  assert.equal(before.bytes, 4355); assert.equal(after.bytes, 4106);
  assert.equal(before.optionalProperties, 20); assert.equal(after.optionalProperties, 0);
  assert.equal(before.unionParameters, 5); assert.equal(after.unionParameters, 5);
  assert.equal(before.maxContainerDepth, 4); assert.equal(after.maxContainerDepth, 5);
  assert.equal(before.optionalPresenceCombinations, "1048576"); assert.equal(after.optionalPresenceCombinations, "1");
  assert.equal(after.combinatorBranches, 0); assert.equal(after.schemaNodes, 44);
  assert.ok(after.optionalProperties < 24); assert.ok(after.unionParameters < 16);
  // A proxy only: do not label any of these numbers compiler states or latency.
  assert.equal(Object.hasOwn(after, "compilerStates"), false);
});

// Exhaust all finite key subsets for every existing tool. Values are synthetic;
// requirements/oneOf/allowEmpty/length/UUID checks remain the production ones.
for (const tool of READ_ONLY_SHADOW_TOOLS) {
  test(`equivalence of every argument-key subset: ${tool}`, () => {
    const names = Object.keys(SHADOW_TOOL_ARGUMENT_SCHEMAS[tool].properties);
    const covered = new Set(); let valid = 0;
    for (let mask = 0; mask < 2 ** names.length; mask++) {
      const raw = Object.fromEntries(names.filter((_, i) => mask & (1 << i)).map((key) => [key, rawValue(key)]));
      let accepted = true;
      try { validateShadowToolArguments(tool, raw); } catch { accepted = false; }
      const bound = boundContext(raw, tool);
      const d = callDecision(tool, bound.args); const input = wire(d);
      if (accepted) {
        valid++; Object.keys(raw).forEach((key) => covered.add(key));
        const actual = decodeReducedShadowAiDecision(input, bound.result);
        assert.deepEqual(actual, normalDecode(d, bound.result));
        assert.deepEqual(actual.proposedToolCalls[0].arguments, raw);
        input.proposedToolCalls[0].arguments.reverse();
        assert.deepEqual(decodeReducedShadowAiDecision(input, bound.result), actual, "pair ordering is irrelevant");
        assert.doesNotMatch(JSON.stringify(actual), /ref_[a-z]+_\d+/);
      } else assert.throws(() => decodeReducedShadowAiDecision(input, bound.result), /invalid_tool_arguments/);
    }
    assert.ok(valid > 0); assert.deepEqual([...covered].sort(), names.sort());
  });
}

for (const [name, argumentsValue] of [
  ["object not list", { propertyId: "ref_invented_1" }], ["null", null],
  ["duplicate key", [{ key: "propertyId", value: "x" }, { key: "propertyId", value: "y" }]],
  ["unknown key", [{ key: "inventedArgument", value: "x" }]],
  ["other tool key", [{ key: "paymentId", value: "x" }]],
  ["prototype key", [{ key: "__proto__", value: "x" }]],
  ["missing value", [{ key: "propertyId" }]], ["missing key", [{ value: "x" }]],
  ["extra pair field", [{ key: "propertyId", value: "x", text: "private" }]],
  ["numeric value", [{ key: "propertyId", value: 42 }]],
  ["null value", [{ key: "propertyId", value: null }]],
  ["nested value", [{ key: "propertyId", value: { id: "private" } }]],
  ["too many pairs", Array.from({ length: 21 }, () => ({ key: "propertyId", value: "x" }))],
]) {
  test(`invalid wire ${name} blocks without returning any tool call`, () => {
    const b = boundContext({ propertyId: rawValue("propertyId") }, "find_properties");
    const d = wire(callDecision("find_properties", b.args)); d.proposedToolCalls[0].arguments = argumentsValue;
    assert.throws(() => decodeReducedShadowAiDecision(d, b.result), /invalid_structured_output:reduced_arguments_/);
  });
}

test("unknown tools, root fields, call fields and business limits remain rejected", () => {
  const b = boundContext({}, "list_administrative_work");
  for (const mutate of [
    (d) => { d.proposedToolCalls[0].tool = "delete_record"; },
    (d) => { d.proposedToolCalls[0].tool = "__proto__"; },
    (d) => { d.private = "unexpected"; }, (d) => { d.proposedToolCalls[0].private = true; },
    (d) => { d.confidence = 1.1; }, (d) => { d.summary = "x".repeat(501); },
    (d) => { d.proposedToolCalls = Array(11).fill(d.proposedToolCalls[0]); },
  ]) {
    const d = wire(callDecision("list_administrative_work", {})); mutate(d);
    assert.throws(() => decodeReducedShadowAiDecision(d, b.result), /invalid_structured_output/);
  }
});

for (const value of ["", "  ", "x".repeat(121)]) {
  test(`business string constraint is retained (${value.length} chars)`, () => {
    const b = boundContext({}, "list_administrative_work");
    assert.throws(() => decodeReducedShadowAiDecision(wire(callDecision("list_administrative_work", { domain: value })), b.result), /invalid_tool_arguments/);
  });
}

test("all tool arguments validate before returning: a later bad call prevents execution of the first", () => {
  const b = boundContext({ propertyId: rawValue("propertyId") }, "find_properties");
  const d = wire(callDecision("find_properties", b.args));
  d.proposedToolCalls.push({ tool: "get_payment_summary", arguments: [], reason: "Consulta" });
  let calls = 0;
  assert.throws(() => {
    const decoded = decodeReducedShadowAiDecision(d, b.result);
    decoded.proposedToolCalls.forEach(() => { calls++; });
  }, /invalid_tool_arguments/);
  assert.equal(calls, 0);
});

for (const bad of ["ref_invented_1", rawValue("propertyId"), "unissued-internal-id", "wrong_type", "other_round"]) {
  test(`privacy and scoped type resolution preserved: ${bad === rawValue("propertyId") ? "direct UUID" : bad}`, () => {
    const b = boundContext({ propertyId: rawValue("propertyId"), contractId: rawValue("contractId") }, "find_properties");
    const other = boundContext({ propertyId: rawValue("propertyId") }, "find_properties");
    const value = bad === "wrong_type" ? b.args.contractId : bad === "other_round" ? other.args.propertyId : bad;
    const d = wire(callDecision("find_properties", { propertyId: value }));
    assert.throws(() => decodeReducedShadowAiDecision(d, b.result), /pre_model_sanitization_blocked/);
  });
}

test("unbound result cannot decode even a decision without tool calls", () => {
  assert.throws(() => decodeReducedShadowAiDecision(wire(decision()), {}), /pre_model_sanitization_blocked/);
});

test("identity type equivalence stays narrow; Respond contact is not a canonical identity", () => {
  const id = rawValue("clientIdentityId");
  for (const type of ["contact_identity", "client_identity", "respond_contact", "property"]) {
    const b = boundContext({ clientIdentityId: id }, "find_administrative_work_by_context", { clientIdentityId: type });
    const d = wire(callDecision("find_administrative_work_by_context", b.args));
    if (["contact_identity", "client_identity"].includes(type)) assert.equal(decodeReducedShadowAiDecision(d, b.result).proposedToolCalls[0].arguments.clientIdentityId, id);
    else assert.throws(() => decodeReducedShadowAiDecision(d, b.result), /pre_model_sanitization_blocked/);
  }
  const b = boundContext({ respondContactId: "synthetic-contact" }, "resolve_contact_identity", { respondContactId: "client_identity" });
  assert.throws(() => decodeReducedShadowAiDecision(wire(callDecision("resolve_contact_identity", b.args)), b.result), /pre_model_sanitization_blocked/);
});

for (const field of ["summary", "contextAssessment", "proposedAction", "escalationReason", "acknowledgement", "clarificationQuestion", "escalationMessage"]) {
  test(`ephemeral alias in ${field} still fails closed, never expands to an ID`, () => {
    const b = boundContext({ propertyId: rawValue("propertyId") }, "find_properties");
    const d = wire(decision());
    if (Object.hasOwn(d.conversationalResponseParts, field)) d.conversationalResponseParts[field] = `Consulta ${b.args.propertyId}`;
    else d[field] = `Consulta ${b.args.propertyId}`;
    assert.throws(() => decodeReducedShadowAiDecision(d, b.result), /pre_model_sanitization_blocked/);
    assert.doesNotMatch(JSON.stringify(d), /b0000000/);
  });
}

for (const value of ["persona@example.com", "+52 222 123 4567", "CLABE 012345678901234567", "sk-ant-syntheticSecret123456", "Ana Perez", "Calle Reforma 123"]) {
  test(`residual in wire free text is rejected (${value.split(" ")[0]})`, () => {
    const b = boundContext({}, "list_administrative_work");
    const d = wire(decision()); d.summary = value;
    assert.throws(() => decodeReducedShadowAiDecision(d, b.result), /pre_model_sanitization_blocked/);
  });
}

test("reduced schema uses the unchanged final-body verifier; no fetch and no real IDs in serialization", () => {
  const raw = { propertyId: rawValue("propertyId") };
  const b = boundContext(raw, "find_properties"); const stages = [];
  const body = { model: "claude-haiku-4-5-20251001", max_tokens: 1400, messages: b.messages,
    output_config: { format: { type: "json_schema", schema: buildReducedAnthropicDecisionSchema() } } };
  const serialized = serializeVerifiedAnthropicBody(body, b.messages, (stage) => stages.push(stage));
  assert.deepEqual(stages, ["final_payload_verified", "body_serialized", "serialized_body_verified"]);
  assert.equal(JSON.stringify(JSON.parse(serialized)), serialized);
  assert.equal(serialized.includes(raw.propertyId), false);
  assert.equal(JSON.parse(serialized).output_config.format.schema.properties.proposedToolCalls.items.properties.arguments.type, "array");
  assert.throws(() => serializeVerifiedAnthropicBody({ ...body, later: { raw: raw.propertyId } }, b.messages), /pre_model_sanitization_blocked/);
});

test("real gateway + synthetic model -> reduced adapter -> real read-only tool with server-side ID", async () => {
  const id = rawValue("propertyId"); let observed; let calls = 0;
  const result = await invokeShadowPhase3A({ envelope: { sanitizedText: "Hay humedad", providerMetadata: { propertyId: id } },
    deterministic: { intent: "mantenimiento", requiresHuman: true }, toolResults: [],
    systemPrompt: REAL_SHADOW_AI_SYSTEM_PROMPT, toolGuide: REAL_SHADOW_AI_TOOL_GUIDE,
    modelCall: async (messages) => {
      calls++; observed = JSON.parse(messages[1].content);
      return { text: JSON.stringify(wire(callDecision("get_maintenance_ticket_summary", { propertyId: observed.metadata.propertyId }))) };
    },
  });
  const decoded = decodeReducedShadowAiDecision(JSON.parse(result.text), result);
  let lookup; const admin = { from(table) {
    assert.equal(table, "maintenance_tickets");
    const q = { select() { return q; }, eq(field, value) { assert.equal(field, "property_id"); lookup = value; return q; }, order() { return q; }, limit: async () => ({ data: [], error: null }) };
    return q; // Deliberately no insert/update/delete/rpc methods.
  } };
  const tool = decoded.proposedToolCalls[0];
  await executeShadowReadOnlyTool(admin, tool.tool, tool.arguments);
  assert.equal(calls, 1); assert.equal(lookup, id);
  assert.equal(JSON.stringify(observed).includes(id), false);
  assert.doesNotMatch(JSON.stringify(decoded), /ref_[a-z]+_\d+/);
});

for (const [intent, text] of [["mantenimiento", "Hay humedad"], ["servicio", "Adjunto comprobante de agua"], ["pago_renta", "Consulta de pago"], ["juridico_conflicto", "Tengo una inconformidad"], ["saludo", "Gracias"]]) {
  test(`unchanged finalization/grounding/3A/3B for synthetic ${intent}`, () => {
    const b = boundContext({}, "list_administrative_work");
    const d = { ...decision(), intent };
    const envelope = { sanitizedText: text, providerMetadata: { priorConversation: [] } };
    const evaluate = (decoded) => {
      const finalDecision = finalizeShadowAiDecision(decoded, envelope, []);
      const resolution = buildShadowOperationalResolution({ decision: finalDecision, envelope, tools: [] });
      if (!SHADOW_CONVERSATION_DOMAINS.includes(resolution.case_domain)) {
        assert.throws(() => buildConversationAction({ resolution, decision: finalDecision }), /invalid_conversation_action_domain/);
        return { finalDecision, resolution, action: null, actionError: "invalid_conversation_action_domain" };
      }
      const action = buildConversationAction({ resolution, decision: finalDecision, turn: { settled: true }, now: 1000 });
      return { finalDecision, resolution, action };
    };
    const before = evaluate(normalDecode(d, b.result));
    const after = evaluate(decodeReducedShadowAiDecision(wire(d), b.result));
    assert.deepEqual(after, before);
    if (after.action) { assert.equal(after.action.requires_human, true); assert.equal(after.action.auto_send_eligible, false); }
    else assert.equal(after.actionError, "invalid_conversation_action_domain");
  });
}

test("evidence aliases and facts survive decoding and existing grounding unchanged", () => {
  const id = rawValue("paymentId"); const scope = createModelPrivacyScope();
  const paymentAlias = scope.reference(id, "payment"); const evidenceAlias = scope.reference(`payment:${id}`, "evidence");
  const messages = bindVerifiedModelMessages([{ role: "user", content: JSON.stringify({ message: "Consulta", evidenceLedger: [{ evidenceId: evidenceAlias, subjectId: paymentAlias }] }) }], scope);
  const result = bindModelResult({}, messages); const d = decision();
  d.factualClaims = [{ factType: "payment.status", value: "pendiente", evidenceIds: [evidenceAlias] }];
  d.conversationalResponseParts.verifiedFactReferences = [evidenceAlias];
  const tools = [{ name: "get_payment_summary", args: { paymentId: id }, ok: true, result: [{ entityType: "payment", internalId: id, status: "pendiente" }] }];
  const before = finalizeShadowAiDecision(normalDecode(d, result), { sanitizedText: "Consulta de pago", providerMetadata: {} }, tools);
  const after = finalizeShadowAiDecision(decodeReducedShadowAiDecision(wire(d), result), { sanitizedText: "Consulta de pago", providerMetadata: {} }, tools);
  assert.deepEqual(after, before); assert.equal(after.groundingStatus, "grounded");
});

test("a previously eligible synthetic 3B response remains exactly eligible, without expanding eligibility", () => {
  const b = boundContext({}, "list_administrative_work");
  const d = { ...decision(), requiresHuman: false, escalationReason: null };
  const resolution = { case_domain: "maintenance", case_status: "existing_open_case", interaction_direction: "inbound_customer_action",
    identity_context: { status: "trusted_link_available" }, evidence: [{ evidenceId: "synthetic-evidence" }],
    missing_information: ["maintenance_location"], action_confidence: .9, requires_human: false };
  for (const requiresHuman of [false, true]) {
    const r = { ...resolution, requires_human: requiresHuman };
    const before = buildConversationAction({ resolution: r, decision: normalDecode(d, b.result), turn: { settled: true }, now: 1000 });
    const after = buildConversationAction({ resolution: r, decision: decodeReducedShadowAiDecision(wire(d), b.result), turn: { settled: true }, now: 1000 });
    assert.deepEqual(after, before);
    assert.equal(after.requires_human, requiresHuman);
    assert.equal(after.auto_send_eligible, !requiresHuman);
  }
});

test("adapter imports stay confined to Replay decoding and its transport schema, without I/O", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  }
  for (const file of [...walk(path.join(root, "lib")), ...walk(path.join(root, "pages"))]) {
    if (!file.endsWith(".js") || file.endsWith("/reducedOutputSchema.js")) continue;
    if (["lib/shadow/ai/anthropic.js", "lib/shadow/ai/historicalReplay.js"].includes(path.relative(root, file))) continue;
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /(?:from|import\s*\()[^\n]*reducedOutputSchema/, file);
  }
  const adapter = fs.readFileSync(new URL("../lib/shadow/ai/reducedOutputSchema.js", import.meta.url), "utf8");
  assert.doesNotMatch(adapter, /\b(?:fetch|process\.env|executeShadowReadOnlyTool|console\.|writeFile|createClient)\s*\(/);
  const transport = fs.readFileSync(new URL("../lib/shadow/ai/anthropic.js", import.meta.url), "utf8");
  assert.match(transport, /function createAnthropicShadowResponse\(messages, options = \{\}\) \{\s*return createAnthropicResponse\(messages, options, false\)/);
  assert.doesNotMatch(transport, /decodeReducedShadowAiDecision/);
});
