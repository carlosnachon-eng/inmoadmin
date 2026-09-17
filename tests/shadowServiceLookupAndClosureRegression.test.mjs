import assert from "node:assert/strict";
import test from "node:test";

import { executeShadowReadOnlyTool, validateShadowToolArguments } from "../lib/shadow/context.js";
import { buildConversationAction } from "../lib/shadow/ai/conversationAction.js";
import { buildShadowOperationalResolution } from "../lib/shadow/ai/operationalResolution.js";
import { deriveRequiredTools } from "../lib/shadow/ai/toolPolicy.js";

const IDS = Object.freeze({
  property: "f13ec53a-89e8-4d7a-8113-fdb801d28811",
  contract: "d2e937eb-9424-44f6-b0c8-f1ba29c4239b",
  identity: "f80aee9d-c740-466a-86de-609c6d8f5ef9",
  water: "9030bdc0-e4b5-4e2f-b2b2-1f8bc9d067c9",
  gas: "aae5ae2d-c5f8-41ee-90bb-4f20d0ae0f6d",
});

function readOnlyDb(tableRows = {}) {
  const reads = [];
  return {
    reads,
    from(table) {
      reads.push(table);
      let rows = [...(tableRows[table] || [])];
      const query = {
        select() { return query; },
        eq(column, value) { rows = rows.filter((row) => row[column] === value); return query; },
        order(column, { ascending = true } = {}) { rows.sort((a, b) => String(a[column] || "").localeCompare(String(b[column] || "")) * (ascending ? 1 : -1)); return query; },
        limit(count) { return Promise.resolve({ data: rows.slice(0, count), error: null }); },
      };
      return query;
    },
  };
}

const property = { id: IDS.property, name: "Propiedad estructurada" };
const services = [
  { id: IDS.water, property_name: property.name, tipo: "agua", aplica: true },
  { id: IDS.gas, property_name: property.name, tipo: "gas_recarga", aplica: true },
];
const payments = [
  { id: "10000000-0000-4000-8000-000000000001", servicio_id: null, property_name: property.name, tipo: "agua", periodo: "2026-09", status: "en_revision", monto: 242, comprobante_url: "private:receipt" },
  { id: "10000000-0000-4000-8000-000000000002", servicio_id: null, property_name: property.name, tipo: "gas_recarga", periodo: "2026-09", status: "en_revision", monto: 1027.95, comprobante_url: "private:receipt" },
];

const identityTool = [{
  name: "resolve_contact_identity", ok: true, result: [
    { entityType: "contact_identity", internalId: IDS.identity, resolved: true, status: "confirmed", roles: ["tenant"] },
    { entityType: "contract", internalId: IDS.contract, propertyId: IDS.property, active: true, status: "activo" },
    { entityType: "property", internalId: IDS.property },
  ],
}];

test("A/3bf4273f0892: gas legacy se localiza por propertyId + serviceType y conserva guarda financiera", async () => {
  const db = readOnlyDb({ properties: [property], servicios_inmueble: services, pagos_servicios: payments });
  const rows = await executeShadowReadOnlyTool(db, "get_service_period_status", { propertyId: IDS.property, serviceType: "gas", period: "2026-09" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].internalId, IDS.gas);
  assert.equal(rows[0].status, "en_revision");
  assert.equal(rows[0].hasReceipt, true);
  assert.equal(rows[0].method, "property_service_type_link");
  const resolution = buildShadowOperationalResolution({
    decision: { intent: "servicio", confidence: 0.88 },
    envelope: { direction: "inbound", sanitizedText: "Adjunto comprobante de gas", providerMetadata: { propertyId: IDS.property, serviceType: "gas", attachmentContext: { present: true, interpreted: true } } },
    tools: [...identityTool, { name: "get_service_period_status", ok: true, result: rows }],
  });
  const action = buildConversationAction({ resolution, decision: { intent: "servicio", confidence: 0.88 }, turn: { settled: true } });
  assert.notEqual(resolution.case_status, "record_not_found");
  assert.equal(resolution.requires_human, true);
  assert.equal(action.auto_send_eligible, false);
});

test("A/1ca6186749f6: agua legacy con servicio_id null usa relación inequívoca por propiedad/tipo", async () => {
  const db = readOnlyDb({ properties: [property], servicios_inmueble: services, pagos_servicios: payments });
  const rows = await executeShadowReadOnlyTool(db, "get_service_period_status", { propertyId: IDS.property, serviceType: "water", period: "2026-09" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].internalId, IDS.water);
  assert.equal(rows[0].period, "2026-09");
  assert.equal(rows[0].hasReceipt, true);
});

test("A: serviceId explícito siempre evita el fallback por propiedad", async () => {
  const db = readOnlyDb({ pagos_servicios: [{ ...payments[0], servicio_id: IDS.water }] });
  const rows = await executeShadowReadOnlyTool(db, "get_service_period_status", { serviceId: IDS.water });
  assert.equal(rows.length, 1);
  assert.deepEqual(db.reads, ["pagos_servicios"]);
  assert.equal(rows[0].method, "explicit_link");
});

test("A: múltiples servicios candidatos fallan cerrados", async () => {
  const db = readOnlyDb({ properties: [property], servicios_inmueble: [services[0], { ...services[0], id: IDS.gas }] });
  await assert.rejects(
    executeShadowReadOnlyTool(db, "get_service_period_status", { propertyId: IDS.property, serviceType: "agua" }),
    /ambiguous_service_context/,
  );
});

test("A: un pago ligado a otro servicio contradice el fallback y falla cerrado", async () => {
  const db = readOnlyDb({
    properties: [property],
    servicios_inmueble: [services[0]],
    pagos_servicios: [{ ...payments[0], servicio_id: IDS.gas }],
  });
  await assert.rejects(
    executeShadowReadOnlyTool(db, "get_service_period_status", { propertyId: IDS.property, serviceType: "agua" }),
    /contradictory_service_period_context/,
  );
});

test("A: planner exige lookup de servicio con propiedad resuelta aunque falte serviceId", () => {
  const policy = deriveRequiredTools({ intent: "servicio", message: "Adjunto comprobante del gas", metadata: { propertyId: IDS.property } });
  assert.deepEqual(policy.requiredNowTools.find((tool) => tool.name === "get_service_period_status")?.args, { propertyId: IDS.property, serviceType: "gas_recarga" });
  assert.equal(policy.expectedAfterClarificationTools.includes("get_service_period_status"), false);
  assert.deepEqual(validateShadowToolArguments("get_service_period_status", { propertyId: IDS.property, serviceType: "agua" }), { propertyId: IDS.property, serviceType: "agua" });
});

test("B/72f5d25f9b07: cierre cordial no consulta servicios ni fabrica record_not_found", () => {
  const message = "Buen día. Gracias.";
  const policy = deriveRequiredTools({ intent: "servicio", message, metadata: { propertyId: IDS.property, serviceType: "agua" } });
  assert.equal(policy.requiredNowTools.some((tool) => tool.name === "get_service_period_status"), false);
  const resolution = buildShadowOperationalResolution({
    decision: { intent: "servicio", confidence: 0.95, proposedAction: "Ninguna. Mensaje de despedida confirmatorio sin solicitud nueva." },
    envelope: { direction: "inbound", sanitizedText: message, providerMetadata: { propertyId: IDS.property, serviceType: "agua" } },
    tools: identityTool,
  });
  const action = buildConversationAction({ resolution, decision: { intent: "servicio", confidence: 0.95 }, turn: { settled: true } });
  assert.equal(resolution.case_status, "no_message");
  assert.deepEqual(resolution.missing_information, []);
  assert.equal(action.conversation_action, "no_message");
  assert.equal(action.blocked_reason, "no_message");
  assert.equal(action.auto_send_eligible, false);
});

test("C/c59e242994da: pendiente realmente inexistente continúa fail-closed", () => {
  const resolution = buildShadowOperationalResolution({
    decision: { intent: "no_determinado", confidence: 0.35 },
    envelope: { direction: "inbound", sanitizedText: "[DOCUMENTO]", providerMetadata: { propertyId: IDS.property, attachmentContext: { present: true, interpreted: false } } },
    tools: identityTool,
  });
  const action = buildConversationAction({ resolution, decision: { intent: "no_determinado", confidence: 0.35 }, turn: { settled: true } });
  assert.equal(resolution.case_status, "pending_not_found");
  assert.equal(resolution.requires_human, true);
  assert.equal(action.auto_send_eligible, false);
});
