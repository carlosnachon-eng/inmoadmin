import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildShadowOperationalResolution,
  shadowOperationalMetrics,
} from "../lib/shadow/ai/operationalResolution.js";
import { READ_ONLY_SHADOW_TOOLS, validateShadowToolArguments } from "../lib/shadow/context.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const decision = (intent, overrides = {}) => ({ intent, confidence: 0.82, resolvedEntities: [], responseBlocked: false, ...overrides });
const envelope = (metadata = {}, text = "") => ({ sanitizedText: text, providerMetadata: metadata });
const okTool = (name, result) => ({ name, ok: true, args: {}, result, durationMs: 8, source: "policy_required", reason: "phase3a" });
const ticket = (overrides = {}) => ({ entityType: "maintenance_ticket", internalId: id(2), status: "nuevo", priority: "alta", category: "plomeria", createdAt: "2026-08-25T00:00:00Z", lastActionAt: "2026-08-25T01:00:00Z", ...overrides });
const payment = (overrides = {}) => ({ entityType: "payment", internalId: id(3), status: "pendiente", amount: 14500, period: "2026-08-01", ...overrides });

test("1 mantenimiento nuevo sin caso requiere humano", () => {
  const r = buildShadowOperationalResolution({ decision: decision("mantenimiento"), envelope: envelope({ propertyId: id(1) }), tools: [okTool("get_maintenance_ticket_summary", [])] });
  assert.equal(r.case_status, "no_existing_case"); assert.equal(r.requires_human, true); assert.equal(r.would_resolve_without_human, false);
});
test("2 mantenimiento abierto informativo es candidato", () => {
  const r = buildShadowOperationalResolution({ decision: decision("mantenimiento", { requiresHuman: false }), envelope: envelope({ propertyId: id(1) }), tools: [okTool("get_maintenance_ticket_summary", [ticket()])] });
  assert.equal(r.case_status, "existing_open_case"); assert.equal(r.would_resolve_without_human, true);
});
test("3 múltiples tickets abiertos se marcan posible duplicado", () => {
  const r = buildShadowOperationalResolution({ decision: decision("mantenimiento"), envelope: envelope({ propertyId: id(1) }), tools: [okTool("get_maintenance_ticket_summary", [ticket(), ticket({ internalId: id(4) })])] });
  assert.equal(r.case_status, "possible_duplicate"); assert.equal(r.requires_human, true);
});
test("4 seguimiento de proveedor conserva responsable sanitizado", () => {
  const r = buildShadowOperationalResolution({ decision: decision("mantenimiento"), envelope: envelope({ ticketId: id(2) }), tools: [okTool("get_maintenance_ticket_summary", [ticket({ responsibleId: id(9) })])] });
  assert.equal(r.identified_entities[0].entity_type, "maintenance_ticket"); assert.equal(r.evidence[0].sourceTool, "get_maintenance_ticket_summary");
});
test("5 comprobante con monto aparentemente coincidente nunca confirma pago", () => {
  const media = { contractId: id(5), attachmentContext: { present: true, interpreted: true, items: [{ interpretation: { interpretationStatus: "completed", extractedFields: { amount: 14500 } } }] } };
  const r = buildShadowOperationalResolution({ decision: decision("pago_renta"), envelope: envelope(media), tools: [okTool("get_payment_summary", [payment()])] });
  assert.equal(r.case_status, "pending_bank_confirmation"); assert.equal(r.requires_human, true); assert.doesNotMatch(r.proposed_action, /pago confirmado/i);
});
test("6 comprobante con monto distinto crea conflicto", () => {
  const media = { contractId: id(5), attachmentContext: { present: true, interpreted: true, items: [{ interpretation: { interpretationStatus: "completed", extractedFields: { amount: 14000 } } }] } };
  const r = buildShadowOperationalResolution({ decision: decision("pago_renta"), envelope: envelope(media), tools: [okTool("get_payment_summary", [payment()])] });
  assert.equal(r.case_status, "amount_conflict"); assert.equal(r.conflict_detected, true);
});
test("7 posible comprobante duplicado permanece en revisión humana", () => {
  const r = buildShadowOperationalResolution({ decision: decision("pago_renta"), envelope: envelope({ paymentId: id(3) }), tools: [okTool("get_payment_summary", [payment({ status: "en_revision" })])] });
  assert.equal(r.requires_human, true); assert.equal(r.would_resolve_without_human, false);
});
test("8 obligación no identificada", () => {
  const r = buildShadowOperationalResolution({ decision: decision("pago_renta"), envelope: envelope({ contractId: id(5) }), tools: [okTool("get_payment_summary", [])] });
  assert.equal(r.case_status, "record_not_found");
});
test("9 pendiente administrativo existente con responsable es candidato", () => {
  const row = { entityType: "work_center_case", internalId: "case:1", status: "open", responsibleId: id(8), priority: "P1" };
  const r = buildShadowOperationalResolution({ decision: decision("no_determinado"), envelope: envelope({ workCenterContextKey: "maintenance:case:1" }), tools: [okTool("get_work_center_case", [row])] });
  assert.equal(r.would_resolve_without_human, true);
});
test("10 pendiente sin responsable requiere humano", () => {
  const row = { entityType: "work_center_case", internalId: "case:1", status: "open", responsibleId: null };
  const r = buildShadowOperationalResolution({ decision: decision("no_determinado"), envelope: envelope({ workCenterContextKey: "maintenance:case:1" }), tools: [okTool("get_work_center_case", [row])] });
  assert.deepEqual(r.missing_information, ["responsible"]); assert.equal(r.requires_human, true);
});
test("11 identidad insuficiente falla cerrado", () => {
  const r = buildShadowOperationalResolution({ decision: decision("mantenimiento"), envelope: envelope({}, "humedad"), tools: [] });
  assert.equal(r.case_status, "insufficient_identity_context"); assert.equal(r.identity_context.status, "insufficient_identity_context");
});
test("12 conflicto conversación ERP queda explícito", () => {
  const media = { paymentId: id(3), attachmentContext: { present: true, interpreted: true, items: [{ interpretation: { interpretationStatus: "completed", extractedFields: { amount: 1 } } }] } };
  const r = buildShadowOperationalResolution({ decision: decision("pago_renta"), envelope: envelope(media), tools: [okTool("get_payment_summary", [payment()])] });
  assert.equal(r.conflict_detected, true); assert.equal(r.action_confidence <= 0.4, true);
});
test("13 resultado vacío no inventa evidencia", () => {
  const r = buildShadowOperationalResolution({ decision: decision("mantenimiento"), envelope: envelope({ ticketId: id(2) }), tools: [okTool("get_maintenance_ticket_summary", [])] });
  assert.deepEqual(r.evidence, []);
});
test("14 fallo de tool se clasifica técnico", () => {
  const tool = { name: "get_maintenance_ticket_summary", ok: false, result: [], error: "db_error" };
  const r = buildShadowOperationalResolution({ decision: decision("mantenimiento"), envelope: envelope({ ticketId: id(2) }), tools: [tool] });
  assert.equal(r.case_status, "technical_error"); assert.equal(r.technical_error, true);
});
test("15 tool no allowlisted es rechazada", () => assert.throws(() => validateShadowToolArguments("send_respond_message", { id: id(1) }), /invalid_tool_arguments/));
test("16 allowlist no contiene escrituras", () => assert.equal(READ_ONLY_SHADOW_TOOLS.some((name) => /create|update|delete|insert|send|close|assign|upsert/i.test(name)), false));
test("17 sin evidencia no es candidato", () => {
  const r = buildShadowOperationalResolution({ decision: decision("mantenimiento"), envelope: envelope({ ticketId: id(2) }), tools: [] });
  assert.equal(r.would_resolve_without_human, false);
});
test("18 interpretación multimedia failed añade información faltante", () => {
  const r = buildShadowOperationalResolution({ decision: decision("mantenimiento"), envelope: envelope({ propertyId: id(1), attachmentContext: { present: true, interpreted: false, items: [] } }), tools: [okTool("get_maintenance_ticket_summary", [ticket()])] });
  assert.ok(r.missing_information.includes("attachment_interpretation")); assert.equal(r.requires_human, true);
});
test("19 interpretación completed sólo actúa como evidencia adicional", () => {
  const r = buildShadowOperationalResolution({ decision: decision("mantenimiento"), envelope: envelope({ propertyId: id(1), attachmentContext: { present: true, interpreted: true, items: [{ interpretation: { interpretationStatus: "completed", category: "possible_maintenance_damage" } }] } }), tools: [okTool("get_maintenance_ticket_summary", [ticket()])] });
  assert.equal(r.case_status, "existing_open_case"); assert.equal(r.evidence.length, 1);
});
test("20 métrica Automation Candidate Rate se deriva determinísticamente", () => {
  const r = buildShadowOperationalResolution({ decision: decision("mantenimiento"), envelope: envelope({ ticketId: id(2) }), tools: [okTool("get_maintenance_ticket_summary", [ticket()])] });
  assert.equal(shadowOperationalMetrics(r).would_resolve_without_human, true);
});
test("21 no existe capacidad outbound", () => {
  const source = readFileSync(new URL("../lib/shadow/ai/operationalResolution.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /respondRequest|sendMessage|SHADOW_OUTBOUND_ENABLED/);
});
test("22 no existen escrituras Respond", () => {
  const source = readFileSync(new URL("../lib/shadow/ai/operationalResolution.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
});
test("23 no existen escrituras ERP", () => {
  const source = readFileSync(new URL("../lib/shadow/context.js", import.meta.url), "utf8");
  const toolSection = source.slice(source.indexOf("export const shadowContextTools"), source.indexOf("const intentTools"));
  assert.doesNotMatch(toolSection, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
});

test("24 vínculo canónico confirmed propaga client_identity_id, contrato y propiedad", () => {
  const identity = okTool("resolve_contact_identity", [
    { entityType: "contact_identity", internalId: id(30), status: "confirmed", resolved: true, roles: ["tenant"] },
    { entityType: "contract", internalId: id(31), propertyId: id(32), status: "activo" },
    { entityType: "property", internalId: id(32) },
  ]);
  const r = buildShadowOperationalResolution({ decision: decision("mantenimiento"), envelope: envelope({ respondContactId: "opaque-contact" }), tools: [identity, okTool("get_maintenance_ticket_summary", [ticket()])] });
  assert.equal(r.identity_context.client_identity_id, id(30));
  assert.deepEqual(r.identity_context.roles, ["tenant"]);
  assert.equal(r.case_status, "existing_open_case");
});

test("25 identidad confirmed con varias propiedades falla por contexto, no por identidad", () => {
  const identity = okTool("resolve_contact_identity", [
    { entityType: "contact_identity", internalId: id(30), status: "confirmed", resolved: true, roles: ["owner"], ambiguousPropertyContext: true },
    { entityType: "property", internalId: id(32) },
    { entityType: "property", internalId: id(33) },
  ]);
  const r = buildShadowOperationalResolution({ decision: decision("mantenimiento"), envelope: envelope({ respondContactId: "opaque-contact" }), tools: [identity] });
  assert.equal(r.case_status, "insufficient_property_context");
  assert.equal(r.identity_context.status, "insufficient_property_context");
  assert.equal(r.would_resolve_without_human, false);
});
