import test from "node:test";
import assert from "node:assert/strict";
import { buildAllowlistedShadowAiContext, invokeShadowPhase3A, invokeHistoricalReplayReducedPhase3A, decodeModelDecisionReferences } from "../lib/shadow/ai/phase3AGateway.js";
import { createModelPrivacyScope, modelReferenceType, scopeForModelResult, verifyFinalModelPayload } from "../lib/shadow/ai/finalModelPrivacy.js";
import { decodeReducedShadowAiDecision, buildReducedAnthropicDecisionSchema } from "../lib/shadow/ai/reducedOutputSchema.js";
import { withHistoricalReplaySchemaContext } from "../lib/shadow/ai/historicalReplaySchemaContext.js";
import { executeHistoricalReplayCase } from "../lib/shadow/ai/historicalReplay.js";
import { anthropicShadowAiDecisionJsonSchema } from "../lib/shadow/ai/schema.js";
import { REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "../lib/shadow/ai/realPrompt.js";
import { REDUCED_REPLAY_TOOL_GUIDE } from "../lib/shadow/ai/historicalReplayToolGuide.js";
import { modelPrivacyReceipt } from "../lib/shadow/ai/modelPrivacyTelemetry.js";
import { projectOutputPrivacyFailure } from "../lib/shadow/ai/outputPrivacyDiagnostics.js";
import { condominiumCases, confirmedCondoTables, memoryAdmin } from "./helpers/condominiumIdentityFixture.mjs";

// Synthetic data only. Native gateway/transport/decoders, no network or database.
const contact = "73592186";
const propertyId = "a1100000-0000-4000-8000-000000000001";
const aliasPattern = /^ref_[a-z]+_\d+$/;
const env = { SHADOW_HISTORICAL_REPLAY_ENABLED: "true", SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED: "true",
  SHADOW_AI_OUTPUT_MODE: "anthropic_json_schema", ANTHROPIC_API_KEY: "synthetic-only",
  SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED: "false", SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED: "false", SHADOW_IDENTITY_CONFIRMATION_ENABLED: "false",
  SHADOW_ADMIN_OUTBOUND_ENABLED: "false", SHADOW_OUTBOUND_ENABLED: "false", SHADOW_ADMIN_WORK_R1_ENABLED: "false", SHADOW_ADMIN_OUTBOUND_CANARY_ENABLED: "false" };
const decision = () => ({ intent: "mantenimiento", secondaryIntents: [], urgency: "normal", summary: "Consulta de mantenimiento",
  entitiesMentioned: [], resolvedEntities: [], entityResolutionStatus: "unresolved", informationNeeded: [], proposedToolCalls: [],
  contextAssessment: "Contexto disponible", proposedAction: "Escalar", factualClaims: [],
  conversationalResponseParts: { acknowledgement: "Entiendo.", verifiedFactReferences: [], clarificationQuestion: null, escalationMessage: null },
  executionCommitment: "none", confidence: .8, requiresHuman: true, escalationReason: "Revisión", safetyFlags: [] });
const envelope = (metadata = { respondContactId: contact }) => ({ provider: "respond_admin", direction: "inbound", sanitizedText: "¿Cómo va el mantenimiento?", providerMetadata: metadata });
const replay = (e) => ({ evaluationMode: "historical_replay", sufficientHistoricalContext: true, temporalGrounding: "current_state", identityGrounding: "current_canonical_mapping", envelope: e });
const response = (d) => ({ ok: true, json: async () => ({ id: "synthetic-request", model: "claude-haiku-4-5-20251001",
  content: [{ type: "text", text: JSON.stringify(d) }], usage: { input_tokens: 5, output_tokens: 2 } }) });
const receipt = { final_payload_verified: true, serialized_body_verified: true, output_mode: "anthropic_json_schema", privacy_stage: "final_model_privacy", provider_invoked: true };
const requestIdentity = (value, reduced = true) => ({ ...decision(), proposedToolCalls: [{ tool: "resolve_contact_identity",
  arguments: reduced ? [{ key: "respondContactId", value }] : { respondContactId: value }, reason: "Consultar identidad" }] });
const decode = (d, r, reduced) => reduced ? decodeReducedShadowAiDecision(d, r) : decodeModelDecisionReferences(d, r);
async function invoke(reduced, extra) {
  const options = { envelope: envelope(), deterministic: {}, systemPrompt: REAL_SHADOW_AI_SYSTEM_PROMPT, toolGuide: REAL_SHADOW_AI_TOOL_GUIDE, ...extra };
  return reduced ? withHistoricalReplaySchemaContext((replaySchemaContext) => invokeHistoricalReplayReducedPhase3A({ ...options, replayCase: replay(options.envelope), replaySchemaContext })) : invokeShadowPhase3A(options);
}

for (const id of [contact, propertyId, "synthetic-respond-contact"]) {
  test(`metadata Respond reference is ephemeral and typed, never raw (${id === propertyId ? "uuid" : id === contact ? "numeric" : "opaque"})`, () => {
    const scope = createModelPrivacyScope(), source = envelope({ respondContactId: id });
    const before = structuredClone(source);
    const context = buildAllowlistedShadowAiContext({ envelope: source, message: source.sanitizedText }, scope);
    assert.deepEqual(Object.keys(context.metadata), ["respondContactId"]);
    const alias = context.metadata.respondContactId;
    assert.match(alias, aliasPattern);
    assert.equal(modelReferenceType("respondContactId"), "respond_contact");
    assert.equal(scope.resolve(alias, "respond_contact"), id);
    for (const type of ["client_identity", "contact_identity", "property", "contract"]) {
      assert.throws(() => scope.resolve(alias, type), (e) => e.reasons.includes("model_reference_type_mismatch"));
    }
    assert.equal(JSON.stringify(context).includes(id), false);
    assert.deepEqual(verifyFinalModelPayload(context, { scope }), { allowed: true, reasons: [] });
    assert.deepEqual(source, before);
  });
}

for (const reduced of [false, true]) {
  const label = reduced ? "reduced Replay" : "general Shadow";
  test(`${label}: native body contains only the alias; decoder restores the contact server-side`, async () => {
    let sent, calls = 0;
    const result = await invoke(reduced, { modelOptions: { env, fetchImpl: async (_url, init) => {
      calls++; const body = JSON.parse(init.body); sent = JSON.parse(body.messages[0].content);
      assert.equal(init.method, "POST"); assert.equal(init.body.includes(contact), false);
      assert.match(sent.metadata.respondContactId, aliasPattern);
      assert.deepEqual(body.output_config.format.schema, reduced ? buildReducedAnthropicDecisionSchema() : anthropicShadowAiDecisionJsonSchema);
      assert.equal(body.system, `${REAL_SHADOW_AI_SYSTEM_PROMPT}\n\n${reduced ? REDUCED_REPLAY_TOOL_GUIDE : REAL_SHADOW_AI_TOOL_GUIDE}`);
      return response(requestIdentity(sent.metadata.respondContactId, reduced));
    } } });
    assert.equal(calls, 1); assert.deepEqual(modelPrivacyReceipt(result), receipt);
    const decoded = decode(JSON.parse(result.text), result, reduced);
    assert.deepEqual(decoded.proposedToolCalls[0].arguments, { respondContactId: contact });
    assert.doesNotMatch(JSON.stringify(decoded), /ref_[a-z]+_\d+/);
    assert.equal(JSON.stringify(modelPrivacyReceipt(result)).includes(contact), false);
  });

  for (const kind of ["raw_id", "raw_uuid", "invented", "wrong_type", "other_round"]) {
    test(`${label}: ${kind} Respond reference still fails closed with safe errors`, async () => {
      let context;
      const options = { envelope: envelope({ respondContactId: contact, propertyId }), modelCall: async (messages) => {
        assert.equal(JSON.stringify(messages).includes(contact), false);
        context = JSON.parse(messages[1].content); return { text: "{}" };
      } };
      let oldAlias;
      if (kind === "other_round") { await invoke(reduced, options); oldAlias = context.metadata.respondContactId; }
      const result = await invoke(reduced, { ...options, round: 1 });
      const value = { raw_id: contact, raw_uuid: propertyId, invented: "ref_invented_99", wrong_type: context.metadata.propertyId, other_round: oldAlias }[kind];
      assert.throws(() => decode(requestIdentity(value, reduced), result, reduced), (error) => {
        assert.equal(error.code, "pre_model_sanitization_blocked");
        if (kind === "wrong_type") assert.deepEqual(error.reasons, ["model_reference_type_mismatch"]);
        const safe = JSON.stringify([error.message, error, projectOutputPrivacyFailure(error)]);
        for (const raw of [contact, propertyId, value]) assert.equal(safe.includes(raw), false);
        return true;
      });
    });
  }

  test(`${label}: no contact means no alias or forced tool`, async () => {
    for (const metadata of [{}, { respondContactId: null }, { respondContactId: "" }]) {
      let calls = 0;
      const result = await invoke(reduced, { envelope: envelope(metadata), admin: { from() { assert.fail("no identity read without contact"); } },
        modelOptions: { env, fetchImpl: async (_url, { body }) => {
          calls++; const context = JSON.parse(JSON.parse(body).messages[0].content);
          assert.deepEqual(context.metadata, {}); assert.deepEqual(context.tools, []); assert.deepEqual(context.evidenceLedger, []);
          return response(decision());
        } } });
      assert.equal(calls, 1); assert.deepEqual(decode(JSON.parse(result.text), result, reduced).proposedToolCalls, []);
    }
  });

  test(`${label}: condominium pre-load is unchanged, contact alias reused within round, fresh across rounds`, async () => {
    const tables = confirmedCondoTables(), before = structuredClone(tables), admin = memoryAdmin(tables), tools = [], contexts = [];
    const c = condominiumCases[0];
    for (const round of [0, 1]) {
      const result = await invoke(reduced, { admin, envelope: envelope({ respondContactId: c.contactId }), toolResults: tools, round,
        modelCall: async (messages) => { contexts.push(JSON.parse(messages[1].content)); return { text: "{}" }; } });
      const context = contexts.at(-1), alias = context.metadata.respondContactId;
      assert.equal(scopeForModelResult(result).resolve(alias, "respond_contact"), c.contactId);
      assert.equal(alias, context.tools[0].args.respondContactId);
      assert.equal(context.tools.length, 1); assert.equal(context.tools[0].result[0].resolved, true);
      assert.equal(context.tools[0].result[0].identityDomain, "condominium");
      assert.deepEqual(context.tools[0].result[0].roles, ["owner"]);
      assert.equal(scopeForModelResult(result).resolve(context.tools[0].result[1].unitId, "condominium_unit"), c.unitId);
      for (const raw of [c.contactId, c.unitId, c.phone, tables.client_identities[0].phone_digest]) assert.equal(JSON.stringify(context).includes(raw), false);
    }
    assert.equal(tools.length, 1); assert.equal(tools[0].args.respondContactId, c.contactId);
    assert.equal(tools[0].result[1].unitId, c.unitId);
    assert.notEqual(contexts[0].metadata.respondContactId, contexts[1].metadata.respondContactId);
    assert.deepEqual(tables, before);
  });
}

test("reduced Replay: emitted contact alias reaches server tool and second round without leaking into result/telemetry", async () => {
  let fetches = 0, toolCalls = 0; const contexts = [];
  const result = await executeHistoricalReplayCase(memoryAdmin(), replay(envelope()), { env, useReducedOutputSchema: true, now: () => 1000,
    fetchImpl: async (_url, { body }) => {
      fetches++; const context = JSON.parse(JSON.parse(body).messages[0].content); contexts.push(context);
      assert.equal(body.includes(contact), false);
      if (fetches === 1) return response(requestIdentity(context.metadata.respondContactId));
      assert.equal(context.tools[0].args.respondContactId, context.metadata.respondContactId);
      assert.equal(context.tools[0].result[0].internalId, context.metadata.respondContactId);
      assert.notEqual(context.metadata.respondContactId, contexts[0].metadata.respondContactId);
      return response(decision());
    }, executeTool: async (_admin, name, args) => {
      toolCalls++; assert.equal(name, "resolve_contact_identity"); assert.deepEqual(args, { respondContactId: contact });
      return [{ entityType: "contact_identity", internalId: contact, resolved: false, status: "insufficient_identity_context" }];
    },
  });
  assert.equal(fetches, 2); assert.equal(toolCalls, 1); assert.deepEqual(result.privacyChecks, [receipt, receipt]);
  assert.equal(result.tools[0].ok, true); assert.equal(result.conversationAction.requires_human, true);
  assert.equal(result.conversationAction.auto_send_eligible, false);
  assert.equal(JSON.stringify(result).includes(contact), false); assert.doesNotMatch(JSON.stringify(result), /ref_[a-z]+_\d+/);
});
