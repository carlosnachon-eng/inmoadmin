import test from "node:test";
import assert from "node:assert/strict";
import { buildShadowOperationalResolution } from "../lib/shadow/ai/operationalResolution.js";
import { buildConversationAction } from "../lib/shadow/ai/conversationAction.js";
import { classifyInteractionDirection } from "../lib/shadow/ai/interactionDirection.js";
import { plannableShadowToolCalls } from "../lib/shadow/ai/actorRoleGuards.js";
import { validateAndSanitizeMediaInterpretation } from "../lib/shadow/media/interpretation.js";

const unresolvedIdentity = [{
  name: "resolve_contact_identity", ok: true,
  result: [{ entityType: "contact_identity", resolved: false, status: "insufficient_identity_context" }],
}];

const receipt = {
  interpretationStatus: "completed", category: "possible_payment_receipt",
  summary: "Ticket por un monomando con total de $909.00.",
  extractedFields: { amount: 909, currency: null }, confidence: 0.78,
  requiresHumanReview: true, reviewReason: "Costo y responsabilidad requieren revisión.",
};

test("regresión sanitizada Terrania: respuesta segura y handoff sensible coexisten", () => {
  const envelope = {
    direction: "inbound",
    sanitizedText: "Tuve que cambiar esta llave de urgencia. Encontré la recámara inundada. La culpable. Se compró esta llave.",
    providerMetadata: {
      channelId: "544519", respondContactId: "respond:opaque",
      attachmentContext: { present: true, interpreted: true, items: [
        { interpretation: { ...receipt, category: "possible_maintenance_damage", summary: "Componente hidráulico con corrosión." } },
        { interpretation: receipt },
      ] },
    },
  };
  assert.equal(classifyInteractionDirection({ envelope }), "inbound_customer_action");
  const decision = { intent: "mantenimiento", confidence: 0.91, resolvedEntities: [] };
  const resolution = buildShadowOperationalResolution({ decision, envelope, tools: unresolvedIdentity });
  const action = buildConversationAction({ resolution, decision, turn: { settled: true }, now: Date.parse("2026-08-31T20:45:00Z") });
  assert.equal(resolution.requires_human, true);
  assert.equal(resolution.operational_follow_up.type, "sensitive_internal_handoff");
  assert.equal(resolution.operational_follow_up.executable, false);
  assert.equal(action.conversation_action, "acknowledge_received_information");
  assert.equal(action.requires_human, true);
  assert.equal(action.auto_send_eligible, false);
  assert.match(action.proposed_message, /reporte.*imágenes.*comprobante/i);
  assert.match(action.proposed_message, /fuga.*inundación.*pieza hidráulica/i);
  assert.match(action.proposed_message, /¿el flujo de agua ya quedó contenido\?/i);
  assert.doesNotMatch(action.proposed_message, /reembolso|quién paga|responsabilidad|autorizad[oa]|pago registrado/i);
});

test("tools sin argumentos válidos se descartan antes de planificar una ronda", () => {
  const calls = plannableShadowToolCalls({ proposedToolCalls: [
    { tool: "resolve_contact_identity", arguments: {}, reason: "sin id" },
    { tool: "find_properties", arguments: {}, reason: "sin referencia" },
    { tool: "get_maintenance_ticket_summary", arguments: {}, reason: "sin id" },
    { tool: "find_properties", arguments: { propertyReference: "Terrania 23" }, reason: "válida" },
  ] });
  assert.deepEqual(calls.map((item) => item.tool), ["find_properties"]);
});

test("moneda se conserva sólo cuando la evidencia la expresa", () => {
  const base = {
    media_type: "image", interpretation_status: "completed", category: "possible_payment_receipt",
    summary: "Ticket por un monomando con total de $909.00.",
    extracted_fields: { amount: 909, currency: "USD", date: null, sender_bank: null, recipient_bank: null, reference: null, account_last4: null, observable_issues: [] },
    confidence: 0.8, requires_human_review: true, review_reason: "Revisión humana.",
  };
  assert.equal(validateAndSanitizeMediaInterpretation(base).extracted_fields.currency, null);
  assert.equal(validateAndSanitizeMediaInterpretation({ ...base, summary: "Total explícito: MXN 909", extracted_fields: { ...base.extracted_fields, currency: "MXN" } }).extracted_fields.currency, "MXN");
});
