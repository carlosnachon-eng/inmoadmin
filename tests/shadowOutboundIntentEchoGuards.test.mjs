import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildConversationAction, conversationDocumentCongruence } from "../lib/shadow/ai/conversationAction.js";
import { buildRealShadowConversationTurns } from "../lib/shadow/ai/conversationTurns.js";
import { buildShadowOperationalResolution } from "../lib/shadow/ai/operationalResolution.js";
import { deriveRequiredTools } from "../lib/shadow/ai/toolPolicy.js";
import { resolvePersistedShadowMessageOrigin } from "../lib/shadow/outboundOrigin.js";
import { resolveRespondOutgoingOrigin, transformRespondAdminPayload } from "../lib/shadow/providers/respondAdmin.js";
import { RESPOND_ADMIN_FIXTURES } from "../lib/shadow/providers/respondAdmin.fixtures.js";
import { ingestShadowEnvelope } from "../lib/shadow/coordinator.js";

const ID = Object.freeze({
  property: "11111111-1111-4111-8111-111111111111",
  service: "22222222-2222-4222-8222-222222222222",
});
const trusted = { status: "trusted_link_available", client_identity_id: "identity:tenant", roles: ["tenant"] };

const actionResolution = (overrides = {}) => ({
  case_domain: "payment", case_status: "record_not_found", interaction_direction: "inbound_customer_action",
  identity_context: trusted, evidence: [], missing_information: ["obligation_or_payment_record"],
  action_confidence: 0.91, requires_human: true, conflict_detected: false, technical_error: false,
  document_context: { equivalent_document_present: false },
  conversation_object_context: {
    customer_intent: "verify_service_receipt_received", object_type: "service_receipt",
    service_type: "electricity", verified_service_evidence_available: false,
  },
  ...overrides,
});

test("recibo de luz consultado nunca se transforma en comprobante de pago", () => {
  const action = buildConversationAction({
    resolution: actionResolution(), decision: { intent: "servicio", confidence: 0.91 }, turn: { settled: true },
  });
  assert.notEqual(action.conversation_action, "request_document");
  assert.equal(action.conversation_action, "human_handoff");
  assert.equal(action.proposed_message, "");
  assert.equal(action.requires_human, true);
  assert.equal(action.auto_send_eligible, false);
});

test("3A requires_human es monotónico en 3B", () => {
  const action = buildConversationAction({
    resolution: actionResolution({
      case_domain: "administrative_pending", case_status: "open", missing_information: [],
      evidence: [{ evidenceId: "verified:1" }], conversation_object_context: {},
    }),
    decision: { intent: "no_determinado", confidence: 0.91 }, turn: { settled: true },
  });
  assert.equal(action.conversation_action, "provide_verified_status");
  assert.equal(action.requires_human, true);
  assert.equal(action.auto_send_eligible, false);
  assert.equal(action.future_auto_send_reason, "operational_resolution_requires_human");
});

test("tipo documental debe coincidir con intención y objeto del turno", () => {
  const mismatch = conversationDocumentCongruence({
    resolution: actionResolution({ missing_information: ["payment_document"] }),
    decision: { intent: "servicio" }, action: "request_document",
  });
  assert.equal(mismatch.allowed, false);
  assert.equal(mismatch.reason, "document_request_conflicts_with_service_receipt_query");

  const matching = conversationDocumentCongruence({
    resolution: actionResolution({
      requires_human: false, missing_information: ["payment_document"],
      conversation_object_context: { customer_intent: null, object_type: null },
    }),
    decision: { intent: "pago_renta" }, action: "request_document",
  });
  assert.equal(matching.allowed, true);
  assert.equal(matching.documentType, "payment_receipt");
});

test("resolución real de consulta de recibo conserva objeto y falla cerrada sin evidencia", () => {
  const resolution = buildShadowOperationalResolution({
    decision: { intent: "servicio", confidence: 0.92, resolvedEntities: [] },
    envelope: {
      direction: "inbound", sanitizedText: "Disculpe, ¿ya le habrá llegado mi recibo de luz?",
      providerMetadata: { respondContactId: "respond:opaque", propertyId: ID.property, serviceId: ID.service },
    },
    tools: [
      { name: "resolve_contact_identity", ok: true, result: [{ entityType: "contact_identity", resolved: true, roles: ["tenant"] }] },
      { name: "get_service_period_status", ok: true, result: [] },
    ],
  });
  assert.equal(resolution.conversation_object_context.customer_intent, "verify_service_receipt_received");
  assert.equal(resolution.conversation_object_context.object_type, "service_receipt");
  assert.equal(resolution.conversation_object_context.service_type, "electricity");
  assert.equal(resolution.conversation_object_context.verified_service_evidence_available, false);
  assert.equal(resolution.requires_human, true);
});

test("get_service_period_status reporta gap cuando identidad/propiedad no producen serviceId", () => {
  const policy = deriveRequiredTools({
    intent: "servicio", message: "¿Ya llegó mi recibo de luz?",
    metadata: { respondContactId: "respond:opaque", propertyId: ID.property },
  });
  assert.ok(policy.expectedAfterClarificationTools.includes("get_service_period_status"));
  assert.equal(policy.requiredNowTools.some((call) => call.name === "get_service_period_status"), false);
  assert.equal(policy.availableIdentifiers.serviceId, undefined);
});

function outboundLookup(rows, error = null) {
  return {
    from(table) {
      assert.equal(table, "shadow_admin_outbound_messages");
      return { select() { return this; }, eq() { return this; }, async limit() { return { data: rows, error }; } };
    },
  };
}

test("provider message id exacto atribuye el eco al sender de InmoAdmin", async () => {
  const payload = structuredClone(RESPOND_ADMIN_FIXTURES.outboundAdmin);
  payload.message.messageId = "provider-sent-1";
  const raw = transformRespondAdminPayload(payload);
  assert.equal(raw.direction, "outbound_human");
  const resolved = await resolveRespondOutgoingOrigin(outboundLookup([{ id: "out-1", status: "sent", provider_message_id: "provider-sent-1" }]), raw);
  assert.equal(resolved.direction, "outbound_ai_inmoadmin");
  assert.equal(resolved.providerMetadata.resolvedOrigin, "inmoadmin_admin_ai");
  assert.equal(resolved.providerMetadata.echoGatePending, false);
});

test("provider message ID conserva idempotencia y no duplica el eco", async () => {
  const payload = structuredClone(RESPOND_ADMIN_FIXTURES.outboundAdmin);
  payload.message.messageId = "provider-idempotent-1";
  const admin = outboundLookup([{ id: "out-1", status: "sent", provider_message_id: "provider-idempotent-1" }]);
  const firstEnvelope = await resolveRespondOutgoingOrigin(admin, transformRespondAdminPayload(payload));
  const secondEnvelope = await resolveRespondOutgoingOrigin(admin, transformRespondAdminPayload(payload));
  const persisted = new Set();
  const ingestAdmin = {
    async rpc(_name, { p_envelope }) {
      if (persisted.has(p_envelope.payloadFingerprint)) return { data: { status: "duplicate", messageId: "shadow-1" }, error: null };
      persisted.add(p_envelope.payloadFingerprint);
      return { data: { status: "accepted", messageId: "shadow-1" }, error: null };
    },
  };
  assert.equal((await ingestShadowEnvelope(ingestAdmin, firstEnvelope)).status, "accepted");
  assert.equal((await ingestShadowEnvelope(ingestAdmin, secondEnvelope)).status, "duplicate");
  assert.equal(persisted.size, 1);
});

test("origen saliente no determinable queda unknown, nunca humano por defecto", async () => {
  const payload = structuredClone(RESPOND_ADMIN_FIXTURES.outboundAdmin);
  delete payload.message.sender;
  const raw = transformRespondAdminPayload(payload);
  assert.equal(raw.direction, "outbound_unknown");
  const resolved = await resolveRespondOutgoingOrigin(outboundLookup([]), raw);
  assert.equal(resolved.direction, "outbound_unknown");
  assert.equal(resolved.providerMetadata.resolvedOrigin, "unknown");
});

test("eco propio no cierra turno ni activa override; humano real sí", () => {
  const conversation = { id: "conversation-1", provider: "respond_admin", channel: "544519" };
  const base = Date.parse("2026-09-01T12:00:00Z");
  const msg = (id, direction, seconds, text) => ({
    id, conversation_id: conversation.id, direction, occurred_at: new Date(base + seconds * 1000).toISOString(),
    sanitized_text: text, external_message_id: id, attachment_metadata: [], provider_metadata: {},
  });
  const ownEchoTurns = buildRealShadowConversationTurns({
    conversations: [conversation], now: base + 180_000,
    messages: [msg("in-1", "inbound", 0, "Primera parte"), msg("ai-1", "outbound_ai_inmoadmin", 10, "Eco"), msg("in-2", "inbound", 20, "Segunda parte")],
  });
  assert.equal(ownEchoTurns.length, 1);
  assert.deepEqual(ownEchoTurns[0].messageIds, ["in-1", "in-2"]);
  assert.equal(ownEchoTurns[0].humanResponseId, null);

  const humanTurns = buildRealShadowConversationTurns({
    conversations: [conversation], now: base + 180_000,
    messages: [msg("in-1", "inbound", 0, "Primera parte"), msg("human-1", "outbound_human", 10, "Respuesta humana")],
  });
  assert.equal(humanTurns.length, 1);
  assert.equal(humanTurns[0].humanResponseId, "human-1");
  assert.equal(humanTurns[0].closedReason, "human_response");
});

test("resolución read-only histórica por provider id no reescribe el evento", () => {
  const stored = { direction: "outbound_human", external_message_id: "provider-sent-1", provider_metadata: {} };
  const resolved = resolvePersistedShadowMessageOrigin(stored, new Map([["provider-sent-1", { id: "out-1", status: "sent" }]]));
  assert.equal(stored.direction, "outbound_human");
  assert.equal(resolved.resolved_direction, "outbound_ai_inmoadmin");
  assert.equal(resolved.message_origin, "inmoadmin_admin_ai");
  assert.equal(resolved.provider_message_ref, "provider…");
});

test("UI separa modelo, 3B, mensaje final y origen real", () => {
  const ui = readFileSync(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
  for (const label of ["Salida inicial del modelo", "Acción normalizada 3B", "Mensaje final enviado", "Origen real"]) assert.match(ui, new RegExp(label));
});

test("migración amplía direcciones sin reescribir histórico", () => {
  const migration = readFileSync(new URL("../supabase/migrations/202609010001_shadow_outbound_origin_attribution.sql", import.meta.url), "utf8");
  assert.match(migration, /outbound_ai_inmoadmin/);
  assert.match(migration, /outbound_unknown/);
  assert.doesNotMatch(migration, /update\s+public\.shadow_messages/i);
});
