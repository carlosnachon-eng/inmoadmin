import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { executeHistoricalReplayCase } from "../lib/shadow/ai/historicalReplay.js";
import { invokeShadowPhase3A, invokeHistoricalReplayReducedPhase3A } from "../lib/shadow/ai/phase3AGateway.js";
import { createHistoricalReplayReducedTransport } from "../lib/shadow/ai/anthropic.js";
import { assertHistoricalReplaySchemaContext, withHistoricalReplaySchemaContext } from "../lib/shadow/ai/historicalReplaySchemaContext.js";
import { anthropicShadowAiDecisionJsonSchema } from "../lib/shadow/ai/schema.js";
import { buildReducedAnthropicDecisionSchema, decodeReducedShadowAiDecision } from "../lib/shadow/ai/reducedOutputSchema.js";
import { REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "../lib/shadow/ai/realPrompt.js";
import { SHADOW_AI_TOOL_GUIDE } from "../lib/shadow/ai/prompt.js";
import { REDUCED_REPLAY_REFERENCE_CONTRACT, REDUCED_REPLAY_TOOL_GUIDE } from "../lib/shadow/ai/historicalReplayToolGuide.js";
import { createModelPrivacyScope, bindVerifiedModelMessages, bindModelResult, modelReferenceType, verifyFinalModelPayload } from "../lib/shadow/ai/finalModelPrivacy.js";
import { SHADOW_TOOL_ARGUMENT_SCHEMAS } from "../lib/shadow/context.js";
import { modelPrivacyReceipt } from "../lib/shadow/ai/modelPrivacyTelemetry.js";
import { memoryAdmin } from "./helpers/condominiumIdentityFixture.mjs";

// All external boundaries are synthetic. No credentials, network or real runs.
const env = { SHADOW_HISTORICAL_REPLAY_ENABLED: "true", SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED: "true",
  SHADOW_AI_OUTPUT_MODE: "anthropic_json_schema", ANTHROPIC_API_KEY: "synthetic-only",
  SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED: "false", SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED: "false", SHADOW_IDENTITY_CONFIRMATION_ENABLED: "false",
  SHADOW_ADMIN_OUTBOUND_ENABLED: "false", SHADOW_OUTBOUND_ENABLED: "false", SHADOW_ADMIN_WORK_R1_ENABLED: "false", SHADOW_ADMIN_OUTBOUND_CANARY_ENABLED: "false" };
const propertyId = "a1100000-0000-4000-8000-000000000001", ticketId = "a1100000-0000-4000-8000-000000000002";
const replayCase = { evaluationMode: "historical_replay", sufficientHistoricalContext: true,
  temporalGrounding: "current_state", identityGrounding: "current_canonical_mapping",
  envelope: { provider: "respond_admin", direction: "inbound", sanitizedText: "¿Cómo va el mantenimiento?",
    providerMetadata: { channelId: "544519", propertyId } } };
const decision = { intent: "mantenimiento", secondaryIntents: [], urgency: "normal", summary: "Consulta de mantenimiento",
  entitiesMentioned: [], resolvedEntities: [], entityResolutionStatus: "unresolved", informationNeeded: [], proposedToolCalls: [],
  contextAssessment: "Contexto disponible", proposedAction: "Escalar", factualClaims: [],
  conversationalResponseParts: { acknowledgement: "Entiendo.", verifiedFactReferences: [], clarificationQuestion: null, escalationMessage: null },
  executionCommitment: "none", confidence: .8, requiresHuman: true, escalationReason: "Revisión", safetyFlags: [] };
const response = (d) => ({ ok: true, json: async () => ({ id: "synthetic-request", model: "claude-haiku-4-5-20251001",
  content: [{ type: "text", text: JSON.stringify(d) }], usage: { input_tokens: 5, output_tokens: 2 } }) });
const pass = { final_payload_verified: true, serialized_body_verified: true, output_mode: "anthropic_json_schema", privacy_stage: "final_model_privacy", provider_invoked: true };
const fail = (privacy_failure_code) => ({ privacy_stage: "final_model_privacy", privacy_failure_code, provider_invoked: false });
const call = (args) => ({ tool: "get_maintenance_ticket_summary", arguments: args, reason: "Consultar estado" });
const wireArgs = (args) => Object.entries(args).map(([key, value]) => ({ key, value }));
const options = (extra = {}) => ({ env, useReducedOutputSchema: true, now: () => 1000, ...extra });
const gatewayOptions = { envelope: replayCase.envelope, deterministic: {}, systemPrompt: REAL_SHADOW_AI_SYSTEM_PROMPT, toolGuide: REAL_SHADOW_AI_TOOL_GUIDE };

test("native Replay reduced transport + two rounds + real read-only tool + grounding are equivalent to the original contract", async () => {
  const results = [];
  for (const reduced of [false, true]) {
    const db = memoryAdmin({ maintenance_tickets: [{ id: ticketId, property_id: propertyId, status: "abierto", priority: "normal" }] }, () => assert.fail("no RPC"));
    const bodies = [], contexts = [];
    const result = await executeHistoricalReplayCase(db, replayCase, options({ useReducedOutputSchema: reduced,
      fetchImpl: async (_url, init) => {
        assert.equal(init.method, "POST");
        const body = JSON.parse(init.body), context = JSON.parse(body.messages[0].content);
        bodies.push(body); contexts.push(context);
        assert.deepEqual(body.output_config.format.schema, reduced ? buildReducedAnthropicDecisionSchema() : anthropicShadowAiDecisionJsonSchema);
        assert.equal(body.system, `${REAL_SHADOW_AI_SYSTEM_PROMPT}\n\n${reduced ? REDUCED_REPLAY_TOOL_GUIDE : REAL_SHADOW_AI_TOOL_GUIDE}`);
        assert.equal(body.model, "claude-haiku-4-5-20251001"); assert.equal(body.max_tokens, 1400);
        assert.doesNotMatch(init.body, /a1100000|synthetic-only/);
        const d = structuredClone(decision);
        if (contexts.length === 1) {
          const args = { propertyId: context.metadata.propertyId };
          d.proposedToolCalls = [call(reduced ? wireArgs(args) : args)];
        } else {
          assert.equal(context.tools[0].name, "get_maintenance_ticket_summary");
          assert.equal(context.tools[0].ok, true);
          assert.equal(context.tools[0].result[0].status, "abierto");
          assert.notEqual(context.metadata.propertyId, contexts[0].metadata.propertyId);
          assert.equal(context.evidenceLedger[0].facts.status, "abierto");
          const id = context.evidenceLedger[0].evidenceId;
          d.factualClaims = [{ factType: "maintenance_ticket.status", value: "abierto", evidenceIds: [id] }];
          d.conversationalResponseParts.verifiedFactReferences = [id];
        }
        return response(d);
      },
    }));
    assert.equal(bodies.length, 2); assert.deepEqual(db.reads, ["maintenance_tickets"]);
    assert.deepEqual(result.privacyChecks, [pass, pass]);
    assert.equal(result.tools[0].ok, true); assert.equal(result.tools[0].resultCount, 1);
    assert.equal(result.inputTokens, 10); assert.equal(result.outputTokens, 4);
    assert.doesNotMatch(JSON.stringify(result), /ref_[a-z]+_\d+/);
    results.push(result);
  }
  // Same final 3A/3B, guards, evidence, tools, usage and message; only wire format differs.
  assert.deepEqual(results[1], results[0]);
});

test("normal gateway ignores spoofed reduced options/env/metadata and returns the original schema", async () => {
  const result = await invokeShadowPhase3A({ ...gatewayOptions, useReducedOutputSchema: true, replaySchemaContext: {}, replayCase,
    envelope: { ...replayCase.envelope, providerMetadata: { ...replayCase.envelope.providerMetadata, useReducedOutputSchema: true } },
    modelOptions: { env: { ...env, SHADOW_REDUCED_OUTPUT_SCHEMA_ENABLED: "true" }, useReducedOutputSchema: true,
      fetchImpl: async (_url, { body }) => {
        assert.deepEqual(JSON.parse(body).output_config.format.schema, anthropicShadowAiDecisionJsonSchema);
        assert.equal(JSON.parse(body).system, `${REAL_SHADOW_AI_SYSTEM_PROMPT}\n\n${SHADOW_AI_TOOL_GUIDE}`);
        assert.ok(!JSON.parse(body).system.includes(REDUCED_REPLAY_REFERENCE_CONTRACT));
        return response(decision);
      } },
  });
  assert.deepEqual(modelPrivacyReceipt(result), pass);
});

test("Replay capability rejects forged, cloned, expired and reused contexts/message arrays", async () => {
  assert.throws(() => createHistoricalReplayReducedTransport([], {}), /historical_replay_schema_context_required/);
  await assert.rejects(invokeHistoricalReplayReducedPhase3A({ ...gatewayOptions, replayCase, replaySchemaContext: {} }), /historical_replay_schema_context_required/);
  let saved, transport, messages; let fetches = 0;
  await withHistoricalReplaySchemaContext(async (context) => {
    saved = context;
    assert.throws(() => assertHistoricalReplaySchemaContext(structuredClone(context)), /historical_replay_schema_context_required/);
    await assert.rejects(invokeHistoricalReplayReducedPhase3A({ ...gatewayOptions, replayCase: { ...replayCase, evaluationMode: "natural" }, replaySchemaContext: context }), /historical_replay_context_required/);
    const result = await invokeHistoricalReplayReducedPhase3A({ ...gatewayOptions, replayCase, replaySchemaContext: context,
      modelCall: async (m, o) => {
        messages = m; transport = createHistoricalReplayReducedTransport(m, context);
        await assert.rejects(transport(structuredClone(m), o), /historical_replay_transport_context_mismatch/);
        const r = await transport(m, o);
        await assert.rejects(transport(m, o), /historical_replay_transport_context_mismatch/);
        return r;
      }, modelOptions: { env, fetchImpl: async () => { fetches++; return response(decision); } },
    });
    assert.deepEqual(modelPrivacyReceipt(result), pass);
  });
  assert.equal(fetches, 1);
  assert.throws(() => assertHistoricalReplaySchemaContext(saved), /historical_replay_schema_context_required/);
  await assert.rejects(transport(messages), /historical_replay_schema_context_required/);
  await assert.rejects(withHistoricalReplaySchemaContext(async (context) => { saved = context; throw Error("synthetic_failure"); }), /synthetic_failure/);
  assert.throws(() => assertHistoricalReplaySchemaContext(saved), /historical_replay_schema_context_required/);
});

for (const mode of ["bad_option", "text_mode", "isolation_off", "not_replay"]) {
  test(`reduced Replay preconditions: ${mode} rejects without provider or tools`, async () => {
    let calls = 0;
    const opts = options({ fetchImpl: () => { calls++; assert.fail("no fetch"); }, executeTool: () => { calls++; assert.fail("no tool"); } });
    let c = replayCase;
    if (mode === "bad_option") opts.useReducedOutputSchema = "true";
    if (mode === "text_mode") opts.env = { ...env, SHADOW_AI_OUTPUT_MODE: "text_json_local" };
    if (mode === "isolation_off") opts.env = { ...env, SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED: "false" };
    if (mode === "not_replay") c = { ...replayCase, evaluationMode: "natural" };
    await assert.rejects(executeHistoricalReplayCase({}, c, opts), /invalid_historical_replay_schema_option|historical_replay_reduced_schema_requires_json_schema|historical_replay_anthropic_disabled|insufficient_historical_context/);
    assert.equal(calls, 0);
  });
}

for (const mutation of ["legacy", "unknown_key", "wrong_tool_key", "duplicate", "invented_alias", "wrong_alias_type", "raw_uuid", "raw_id", "empty_reference", "null_reference", "descriptive_reference", "free_text_alias"]) {
  test(`reduced wire validation rejects ${mutation} before tools without fallback/retry`, async () => {
    let fetches = 0, tools = 0;
    await assert.rejects(executeHistoricalReplayCase({}, replayCase, options({
      fetchImpl: async (_url, { body }) => {
        fetches++; const context = JSON.parse(JSON.parse(body).messages[0].content), d = structuredClone(decision);
        const args = wireArgs({ propertyId: context.metadata.propertyId });
        if (mutation === "unknown_key") args.push({ key: "unrecognized", value: "value" });
        if (mutation === "wrong_tool_key") args.push({ key: "period", value: "2026-09" });
        if (mutation === "duplicate") args.push({ ...args[0] });
        if (mutation === "invented_alias") args[0].value = "ref_invented_99";
        if (mutation === "wrong_alias_type") args[0].key = "ticketId";
        if (mutation === "raw_uuid") args[0].value = propertyId;
        if (mutation === "raw_id") args[0].value = "12345";
        if (mutation === "empty_reference") args[0].value = "";
        if (mutation === "null_reference") args[0].value = null;
        if (mutation === "descriptive_reference") args[0].value = "el inmueble indicado";
        if (mutation === "free_text_alias") d.summary = context.metadata.propertyId;
        d.proposedToolCalls = [call(mutation === "legacy" ? { propertyId: context.metadata.propertyId } : args)];
        return response(d);
      }, executeTool: async () => { tools++; return []; },
    })), (e) => {
      assert.match(e.message, /invalid_structured_output:reduced_arguments_|pre_model_sanitization_blocked/);
      assert.deepEqual(e.historicalReplayTelemetry.privacyChecks, [pass]); return true;
    });
    assert.equal(fetches, 1); assert.equal(tools, 0);
  });
}

test("a prior-round alias cannot be used by a reduced second round", async () => {
  let alias, fetches = 0, tools = 0;
  await assert.rejects(executeHistoricalReplayCase({}, replayCase, options({
    fetchImpl: async (_url, { body }) => {
      fetches++; const c = JSON.parse(JSON.parse(body).messages[0].content);
      if (fetches === 1) alias = c.metadata.propertyId;
      else assert.notEqual(c.metadata.propertyId, alias);
      return response({ ...decision, proposedToolCalls: [call(wireArgs({ propertyId: alias }))] });
    }, executeTool: async () => { tools++; return []; },
  })), /pre_model_sanitization_blocked/);
  assert.equal(fetches, 2); assert.equal(tools, 1);
});

test("the fixed reduced guide covers reference/literal keys without changing the existing tool contracts", () => {
  assert.equal(REAL_SHADOW_AI_TOOL_GUIDE, SHADOW_AI_TOOL_GUIDE);
  assert.equal(REDUCED_REPLAY_TOOL_GUIDE, `${SHADOW_AI_TOOL_GUIDE}\n\n${REDUCED_REPLAY_REFERENCE_CONTRACT}`);
  const keys = [...new Set(Object.values(SHADOW_TOOL_ARGUMENT_SCHEMAS).flatMap((s) => Object.keys(s.properties)))];
  const referenceLine = REDUCED_REPLAY_REFERENCE_CONTRACT.split("\n").find((s) => s.startsWith("- Son argumentos de referencia:"));
  const literalLine = REDUCED_REPLAY_REFERENCE_CONTRACT.split("\n").find((s) => s.startsWith("- domain,"));
  assert.deepEqual(keys.filter((key) => !modelReferenceType(key)).sort(), ["domain", "period", "serviceType", "sourceType", "status"]);
  for (const key of keys) assert.ok((modelReferenceType(key) ? referenceLine : literalLine).includes(key), key);
  assert.match(REDUCED_REPLAY_REFERENCE_CONTRACT, /copia exactamente el valor ref_\.\.\./);
  assert.match(REDUCED_REPLAY_REFERENCE_CONTRACT, /no solicites esa tool/);
  assert.match(REDUCED_REPLAY_REFERENCE_CONTRACT, /omite su par \{key,value\}/);
});

test("reduced gateway selects its fixed guide only after validating the Replay capability", async () => {
  await withHistoricalReplaySchemaContext(async (context) => {
    const result = await invokeHistoricalReplayReducedPhase3A({ ...gatewayOptions, toolGuide: "ignored caller guide", replayCase, replaySchemaContext: context,
      modelOptions: { env, fetchImpl: async (_url, { body }) => {
        assert.equal(JSON.parse(body).system, `${REAL_SHADOW_AI_SYSTEM_PROMPT}\n\n${REDUCED_REPLAY_TOOL_GUIDE}`);
        return response(decision);
      } },
    });
    assert.deepEqual(modelPrivacyReceipt(result), pass);
  });
});

test("no emitted reference: omitting the tool completes without empty/invented arguments or a provider retry", async () => {
  const noReference = { ...replayCase, envelope: { ...replayCase.envelope, providerMetadata: {} } };
  const results = [];
  for (const reduced of [false, true]) {
    let fetches = 0;
    results.push(await executeHistoricalReplayCase({}, noReference, options({ useReducedOutputSchema: reduced,
      fetchImpl: async (_url, { body }) => {
        fetches++;
        const context = JSON.parse(JSON.parse(body).messages[0].content);
        assert.deepEqual(context.metadata, {});
        assert.deepEqual(context.tools, []);
        assert.deepEqual(context.evidenceLedger, []);
        return response(decision);
      }, executeTool: () => assert.fail("no tool without a reference"),
    })));
    assert.equal(fetches, 1);
  }
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[1].privacyChecks, [pass]);
});

for (const [tool, raw] of [
  ["list_administrative_work", { domain: "maintenance", status: "pending" }],
  ["find_administrative_work_by_context", { sourceType: "contract", sourceId: propertyId }],
  ["get_service_period_status", { propertyId, serviceType: "agua", period: "2026-09" }],
]) {
  test(`reduced reference contract preserves literal arguments for ${tool}`, () => {
    const scope = createModelPrivacyScope();
    const aliases = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key,
      modelReferenceType(key, raw, tool) ? scope.reference(value, modelReferenceType(key, raw, tool)) : value]));
    const messages = bindVerifiedModelMessages([{ role: "user", content: JSON.stringify({ message: "Consulta", metadata: aliases }) }], scope);
    const result = bindModelResult({}, messages);
    const decoded = decodeReducedShadowAiDecision({ ...decision, proposedToolCalls: [{ tool, arguments: wireArgs(aliases), reason: "Consultar estado" }] }, result);
    assert.deepEqual(decoded.proposedToolCalls[0].arguments, raw);
  });
}

test("registering the exact static guide does not exempt modified prompts or data from privacy checks", () => {
  const system = `${REAL_SHADOW_AI_SYSTEM_PROMPT}\n\n${REDUCED_REPLAY_TOOL_GUIDE}`;
  assert.equal(verifyFinalModelPayload({ system }, { transport: true }).allowed, true);
  for (const residual of [propertyId, "test@example.invalid", "+52 222 123 4567", "sk-ant-synthetic-secret-value"]) {
    assert.equal(verifyFinalModelPayload({ system: `${system}\n${residual}` }, { transport: true }).allowed, false);
    assert.equal(verifyFinalModelPayload({ system, message: residual }, { transport: true }).allowed, false);
  }
});

for (const stage of ["final_payload_rejected", "serialized_body_rejected"]) {
  for (const failedRound of [1, 2]) {
    test(`reduced round ${failedRound} blocks ${stage} before that fetch`, async () => {
      const stringify = JSON.stringify; let fetches = 0, tools = 0;
      // Mutate the test-only env after round one's tool to exercise final-body
      // validation; serialization injection independently tests the exact string.
      const localEnv = { ...env };
      if (stage === "final_payload_rejected" && failedRound === 1) localEnv.SHADOW_AI_MODEL = propertyId;
      try {
        if (stage === "serialized_body_rejected") JSON.stringify = (v, ...args) => v?.max_tokens === 1400 && fetches + 1 === failedRound
          ? stringify({ ...v, syntheticResidual: propertyId }, ...args) : stringify(v, ...args);
        await assert.rejects(executeHistoricalReplayCase({}, replayCase, options({ env: localEnv,
          fetchImpl: async (_url, { body }) => {
            fetches++; const c = JSON.parse(JSON.parse(body).messages[0].content);
            return response({ ...decision, proposedToolCalls: [call(wireArgs({ propertyId: c.metadata.propertyId }))] });
          }, executeTool: async () => {
            tools++; if (stage === "final_payload_rejected") localEnv.SHADOW_AI_MODEL = propertyId;
            return [];
          },
        })), (e) => {
          assert.deepEqual(e.historicalReplayTelemetry.privacyChecks, [...(failedRound === 2 ? [pass] : []), fail(stage)]);
          return true;
        });
      } finally { JSON.stringify = stringify; }
      assert.equal(fetches, failedRound - 1); assert.equal(tools, failedRound - 1);
    });
  }
}

test("architecture confines schema capability, dedicated gateway and decoder to Replay", () => {
  const root = new URL("../", import.meta.url);
  function walk(dir) {
    return fs.readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((f) => f.isDirectory()
      ? walk(`${dir}/${f.name}`) : /\.(?:js|mjs)$/.test(f.name) ? [`${dir}/${f.name}`] : []);
  }
  const limits = {
    withHistoricalReplaySchemaContext: ["lib/shadow/ai/historicalReplaySchemaContext.js", "lib/shadow/ai/historicalReplay.js"],
    invokeHistoricalReplayReducedPhase3A: ["lib/shadow/ai/phase3AGateway.js", "lib/shadow/ai/historicalReplay.js"],
    createHistoricalReplayReducedTransport: ["lib/shadow/ai/anthropic.js", "lib/shadow/ai/phase3AGateway.js"],
    decodeReducedShadowAiDecision: ["lib/shadow/ai/reducedOutputSchema.js", "lib/shadow/ai/historicalReplay.js"],
    useReducedOutputSchema: ["lib/shadow/ai/historicalReplay.js", "pages/api/operaciones/shadow-historical-replay.js"],
    REDUCED_REPLAY_TOOL_GUIDE: ["lib/shadow/ai/historicalReplayToolGuide.js", "lib/shadow/ai/phase3AGateway.js", "lib/shadow/ai/finalModelPrivacy.js"],
    REDUCED_REPLAY_REFERENCE_CONTRACT: ["lib/shadow/ai/historicalReplayToolGuide.js"],
  };
  for (const file of [...walk("lib"), ...walk("pages")]) {
    const source = fs.readFileSync(new URL(file, root), "utf8");
    for (const [name, allowed] of Object.entries(limits)) if (source.includes(name)) assert.ok(allowed.includes(path.posix.normalize(file)), `${file}: ${name}`);
  }
  const transport = fs.readFileSync(new URL("lib/shadow/ai/anthropic.js", root), "utf8");
  assert.match(transport, /createAnthropicShadowResponse\(messages, options = \{\}\)\s*\{\s*return createAnthropicResponse\(messages, options, false\)/);
  assert.equal((transport.match(/await fetchImpl\(/g) || []).length, 1);
  assert.match(transport, /serializeVerifiedAnthropicBody\(body, messages/);
  assert.match(transport, /body: serializedBody/);
});
