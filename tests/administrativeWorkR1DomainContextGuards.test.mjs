import test from "node:test";
import assert from "node:assert/strict";
import { selectRelevantPriorContext } from "../lib/shadow/ai/conversationTurns.js";
import { effectiveContractState } from "../lib/shadow/identityBridge.js";
import { buildShadowOperationalResolution, hasPositiveMaintenanceEvidence } from "../lib/shadow/ai/operationalResolution.js";
import { buildConversationAction } from "../lib/shadow/ai/conversationAction.js";
import { administrativeWorkR1SourceEligible, planAdministrativeWorkR1, R1_CONFIDENCE_THRESHOLDS } from "../lib/shadow/ai/administrativeWorkR1.js";

const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const env = { SHADOW_ADMIN_WORK_R1_ENABLED: "true", SHADOW_ADMIN_WORK_R1_NOT_BEFORE: "2026-08-31T20:00:00Z" };
const context = { clientIdentityId: id(1), contractId: id(2), propertyId: id(3) };
const baseEnvelope = { direction: "inbound", occurredAt: "2026-08-31T22:57:21Z", sanitizedText: "Hay una fuga en el baño", providerMetadata: { channelId: "544519", priorConversation: [], attachmentContext: { present: false, interpreted: false, items: [] } } };
const identityTool = { name: "resolve_contact_identity", ok: true, result: [
  { entityType: "contact_identity", internalId: id(1), resolved: true, status: "confirmed", roles: ["tenant"] },
  { entityType: "contract", internalId: id(2), propertyId: id(3), status: "finalizando", active: false },
  { entityType: "property", internalId: id(3) },
] };
const maintenanceTool = { name: "get_maintenance_ticket_summary", ok: true, result: [{ entityType: "maintenance_ticket", internalId: id(4), status: "abierto" }] };

const eligibleResolution = (overrides = {}) => ({
  case_domain: "maintenance", case_status: "existing_open_case", requires_human: false,
  identity_context: { status: "trusted_link_available" }, interaction_direction: "inbound_customer_action",
  conflict_detected: false, technical_error: false, missing_information: [], action_confidence: 0.96,
  domain_evidence: { maintenance: true, property_handover: false }, context_contradiction: false,
  ...overrides,
});

test("regresión Eduardo conserva tema de entrega fuera de los últimos ocho mensajes", () => {
  const history = [
    ["inbound", "El departamento se entrega el lunes próximo verdad ?"],
    ["outbound_human", "Ese es el día máximo"],
    ["outbound_human", "Sólo para confirmar la fecha de entrega"],
    ["inbound", "Sería el lunes a partir de la 1:30"],
    ["outbound_human", "lunes a las 4 pm?"],
    ["inbound", "qué hay que tener para entregarlo"],
    ["outbound_human", "todos los pagos al corriente, llaves, tarjetas"],
    ["inbound", "Okey"], ["inbound", "La veo a las 4 pm?"], ["outbound_human", "Sí"],
    ["outbound_human", "Como 4:10 llegan"], ["inbound", "Okey"],
    ["outbound_human", "Ya está mi jefe afuera del depa"], ["outbound_human", "No le abre nadie"],
  ].map(([direction, sanitizedText], index) => ({ direction, sanitizedText, occurredAt: new Date(Date.UTC(2026, 7, 24, 12, index)).toISOString() }));
  const selected = selectRelevantPriorContext(history, "Buenas tardes. Disculpe no tenía señal. Pero ya lo entregué");
  assert.ok(selected.length <= 8);
  assert.match(selected.map((x) => x.sanitizedText).join(" "), /departamento se entrega|fecha de entrega|llaves, tarjetas/i);
});

test("Eduardo se canonicaliza como property_handover y nunca maintenance", () => {
  const envelope = { ...baseEnvelope, sanitizedText: "Buenas tardes. Disculpe no tenía señal. Pero ya lo entregué", providerMetadata: { ...baseEnvelope.providerMetadata, contractId: id(2), propertyId: id(3), priorConversation: [
    { actor: "contact", direction: "inbound", sanitizedText: "El departamento se entrega el lunes" },
    { actor: "emporio_human", direction: "outbound_human", sanitizedText: "Para entregarlo: llaves, tarjetas y departamento en buenas condiciones" },
  ] } };
  const resolution = buildShadowOperationalResolution({ decision: { intent: "mantenimiento", confidence: 0.95, resolvedEntities: [] }, envelope, tools: [identityTool] });
  assert.equal(resolution.effective_intent, "entrega_inmueble");
  assert.equal(resolution.case_domain, "property_handover");
  assert.equal(resolution.identity_context.roles[0], "tenant");
  assert.equal(resolution.requires_human, true);
  assert.ok(resolution.missing_information.includes("physical_handover_confirmation"));
  assert.equal(resolution.domain_evidence.maintenance, false);
  const action = buildConversationAction({ resolution, decision: { intent: "mantenimiento", confidence: 0.95 }, turn: { settled: true } });
  assert.equal(action.case_domain, "property_handover");
  assert.equal(action.conversation_action, "no_message");
  assert.equal(action.proposed_message, "");
  assert.equal(action.auto_send_eligible, false);
  assert.equal(administrativeWorkR1SourceEligible({ envelope, resolution, context, conversationAction: action, env }).eligible, false);
});

test("llaves en entrega no constituyen mantenimiento", () => {
  const envelope = { ...baseEnvelope, sanitizedText: "Ya entregué las llaves y tarjetas del departamento" };
  assert.equal(hasPositiveMaintenanceEvidence({ envelope, tools: [] }), false);
  const resolution = buildShadowOperationalResolution({ decision: { intent: "mantenimiento", confidence: 0.96 }, envelope: { ...envelope, providerMetadata: { ...envelope.providerMetadata, contractId: id(2), propertyId: id(3) } }, tools: [identityTool] });
  assert.equal(resolution.case_domain, "property_handover");
});

test("maintenance real con fuga y ticket conserva dominio sustentado", () => {
  const resolution = buildShadowOperationalResolution({ decision: { intent: "mantenimiento", confidence: 0.96, requiresHuman: false }, envelope: { ...baseEnvelope, providerMetadata: { ...baseEnvelope.providerMetadata, contractId: id(2), propertyId: id(3) } }, tools: [identityTool, maintenanceTool] });
  assert.equal(resolution.case_domain, "maintenance");
  assert.equal(resolution.domain_evidence.maintenance, true);
  assert.equal(resolution.case_status, "existing_open_case");
  assert.equal(resolution.requires_human, false);
  assert.equal(administrativeWorkR1SourceEligible({ envelope: baseEnvelope, resolution, context, env }).eligible, true);
});

test("gate R1 bloquea baja confianza, requires_human, faltantes y caso nuevo no sustentado", () => {
  assert.equal(administrativeWorkR1SourceEligible({ envelope: baseEnvelope, resolution: eligibleResolution({ action_confidence: 0.87 }), context, env }).reason, "r1_confidence_below_minimum");
  assert.equal(administrativeWorkR1SourceEligible({ envelope: baseEnvelope, resolution: eligibleResolution({ requires_human: true }), context, env }).reason, "requires_human");
  assert.equal(administrativeWorkR1SourceEligible({ envelope: baseEnvelope, resolution: eligibleResolution({ missing_information: ["maintenance_case"] }), context, env }).reason, "operational_information_missing");
  assert.equal(administrativeWorkR1SourceEligible({ envelope: baseEnvelope, resolution: eligibleResolution({ case_status: "no_existing_case", domain_evidence: { maintenance: false } }), context, env }).reason, "maintenance_positive_evidence_required");
});

test("gate R1 bloquea contradicción y acción conversacional incierta", () => {
  assert.equal(administrativeWorkR1SourceEligible({ envelope: baseEnvelope, resolution: eligibleResolution({ context_contradiction: true }), context, env }).reason, "context_contradiction");
  assert.equal(administrativeWorkR1SourceEligible({ envelope: baseEnvelope, resolution: eligibleResolution(), context, conversationAction: { conversation_action: "human_handoff", requires_human: true }, env }).reason, "conversation_context_uncertain");
});

test("contrato se reevalúa temporalmente como finalizando o vencido", () => {
  assert.deepEqual(effectiveContractState({ status: "activo", start_date: "2026-05-01", end_date: "2026-08-31" }, Date.parse("2026-08-31T22:00:00Z")), { status: "finalizando", active: false });
  assert.deepEqual(effectiveContractState({ status: "activo", start_date: "2026-05-01", end_date: "2026-08-31" }, Date.parse("2026-09-01T01:00:00Z")), { status: "vencido", active: false });
  assert.deepEqual(effectiveContractState({ status: "vencido", end_date: "2026-09-30" }, Date.parse("2026-08-31T22:00:00Z")), { status: "vencido", active: false });
});

test("un trabajo existente no se duplica y usa actualización reversible", () => {
  const plan = planAdministrativeWorkR1({ run: { id: id(8) }, message: { id: id(9) }, envelope: baseEnvelope, resolution: eligibleResolution(), context, existingWork: { id: id(10), status: "open" } });
  assert.equal(plan.action, "append_structured_internal_note");
  assert.notEqual(plan.action, "create_administrative_pending");
});

test("R1 OFF falla cerrado y umbrales quedan documentados por acción", () => {
  assert.equal(administrativeWorkR1SourceEligible({ envelope: baseEnvelope, resolution: eligibleResolution(), context, env: { ...env, SHADOW_ADMIN_WORK_R1_ENABLED: "false" } }).reason, "r1_disabled");
  assert.deepEqual(Object.keys(R1_CONFIDENCE_THRESHOLDS).sort(), [
    "append_structured_internal_note", "assign_operational_responsible", "create_administrative_pending", "link_received_evidence",
    "mark_information_received", "mark_possible_duplicate", "schedule_nonfinancial_follow_up", "set_nonfinancial_next_step",
  ].sort());
  assert.ok(Object.values(R1_CONFIDENCE_THRESHOLDS).every((value) => value >= 0.90));
});
