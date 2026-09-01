import test from "node:test";
import assert from "node:assert/strict";
import { buildShadowOperationalResolution } from "../lib/shadow/ai/operationalResolution.js";
import { buildConversationAction } from "../lib/shadow/ai/conversationAction.js";
import { administrativeWorkR1SourceEligible } from "../lib/shadow/ai/administrativeWorkR1.js";

const unresolvedIdentity = [{ name: "resolve_contact_identity", ok: true, result: [{ entityType: "contact_identity", resolved: false }] }];
const envelope = (sanitizedText, extra = {}) => ({
  direction: "inbound", sanitizedText,
  providerMetadata: { channelId: "544519", respondContactId: "respond:opaque", ...extra },
});
const evaluate = ({ text, intent = "no_determinado", metadata = {}, tools = unresolvedIdentity } = {}) => {
  const decision = { intent, confidence: 0.91, resolvedEntities: [] };
  const resolution = buildShadowOperationalResolution({ decision, envelope: envelope(text, metadata), tools });
  const action = buildConversationAction({ resolution, decision, turn: { settled: true }, now: Date.parse("2026-08-31T18:00:00Z") });
  return { resolution, action };
};

test("correo recibido puede reconocerse sin afirmar identidad", () => {
  const { resolution, action } = evaluate({ text: "Les paso mi correo: [EMAIL]" });
  assert.equal(resolution.case_status, "insufficient_identity_context");
  assert.equal(resolution.requires_human, true);
  assert.equal(action.conversation_action, "acknowledge_received_information");
  assert.equal(action.requires_human, true);
  assert.equal(action.auto_send_eligible, false);
  assert.match(action.proposed_message, /recibí la información/i);
  assert.doesNotMatch(action.proposed_message, /inquilin|propietari|contrato|pago/i);
});

test("comprobante recibido sólo reconoce evidencia pendiente de validación", () => {
  const { action } = evaluate({ text: "Les mando el comprobante", intent: "pago_renta", metadata: { attachmentContext: { present: true, interpreted: true, items: [] } } });
  assert.equal(action.conversation_action, "acknowledge_received_information");
  assert.equal(action.auto_send_eligible, false);
  assert.match(action.proposed_message, /recibí el comprobante.*pendiente de validación/i);
  assert.doesNotMatch(action.proposed_message, /pago (?:aplicado|confirmado)|saldo|banco/i);
});

test("humedad sin ubicación formula una sola pregunta segura", () => {
  const { action } = evaluate({ text: "Tengo humedad", intent: "mantenimiento" });
  assert.equal(action.conversation_action, "ask_missing_information");
  assert.deepEqual(action.missing_information, ["location"]);
  assert.equal(action.identity_independent_kind, "maintenance_location");
  assert.equal(action.auto_send_eligible, false);
  assert.match(action.proposed_message, /en qué parte/i);
});

test("referencia C24 no resuelta aclara propiedad sin afirmar pertenencia", () => {
  const { action } = evaluate({ text: "Soy del C24" });
  assert.equal(action.conversation_action, "clarify_property");
  assert.equal(action.auto_send_eligible, false);
  assert.match(action.proposed_message, /a qué propiedad o unidad/i);
  assert.doesNotMatch(action.proposed_message, /tu(?:s)? propiedad/i);
});

for (const text of [
  "¿Cuál es mi saldo de renta?", "¿Ya quedó aplicado mi pago?", "¿Quién paga la comisión?",
  "Quiero negociar el contrato", "Solicito devolución del depósito", "Necesito autorización legal",
]) test(`materia dependiente o sensible permanece fail-closed: ${text}`, () => {
  const { action } = evaluate({ text, intent: /pago|saldo|renta/i.test(text) ? "pago_renta" : "no_determinado" });
  assert.equal(action.conversation_action, "human_handoff");
  assert.equal(action.auto_send_eligible, false);
  assert.equal(action.proposed_message, "");
});

test("documento existente no vuelve a solicitarse", () => {
  const { action } = evaluate({ text: "Les envío el documento", metadata: { attachmentContext: { present: true, interpreted: true, items: [] } } });
  assert.equal(action.conversation_action, "acknowledge_received_information");
  assert.notEqual(action.conversation_action, "request_document");
});

test("instrucción interna sigue sin mensaje aun si menciona evidencia", () => {
  const { action } = evaluate({ text: "A la clienta pídele el documento", metadata: { authorRole: "administrator" } });
  assert.equal(action.conversation_action, "no_message");
  assert.equal(action.auto_send_eligible, false);
});

test("R1 conserva identidad confirmed como constraint duro", () => {
  const { resolution } = evaluate({ text: "Tengo humedad", intent: "mantenimiento" });
  const result = administrativeWorkR1SourceEligible({
    envelope: { ...envelope("Tengo humedad"), occurredAt: "2026-08-31T18:00:00Z" }, resolution,
    context: { clientIdentityId: null },
    env: { SHADOW_ADMIN_WORK_R1_ENABLED: "true", SHADOW_ADMIN_WORK_R1_NOT_BEFORE: "2026-08-31T17:00:00Z" },
    now: Date.parse("2026-08-31T18:00:00Z"),
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "identity_not_confirmed");
});
