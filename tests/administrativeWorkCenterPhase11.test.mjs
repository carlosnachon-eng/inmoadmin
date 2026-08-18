import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../lib/operaciones/administrativeWorkCenter.js", import.meta.url), "utf8");
const owner = await readFile(new URL("../lib/operaciones/ownerLiquidation.js", import.meta.url), "utf8");
const loadable = source.replace(
  'import { calculateOwnerLiquidation, maintenanceOwnerBalance } from "./ownerLiquidation.js";',
  owner.replaceAll("export function", "function"),
);
const { buildAdministrativeWorkCenter, resolveServiceContractRelation } = await import(
  `data:text/javascript;base64,${Buffer.from(loadable).toString("base64")}`
);
const ui = await readFile(new URL("../pages/mi-trabajo-administrativo.js", import.meta.url), "utf8");
const hook = await readFile(new URL("../lib/useContextualRecord.js", import.meta.url), "utf8");
const options = { today: "2026-08-18", now: new Date("2026-08-18T18:00:00Z") };

const base = (service, payments = [], contracts = []) => ({
  properties: [{ id: "property-1", name: "Casa QA" }],
  contracts,
  servicios_inmueble: [service],
  pagos_servicios: payments,
});
const activeContract = { id: "contract-1", property_name: "Casa QA", status: "activo", start_date: "2026-01-01", end_date: "2026-12-31" };
const service = { id: "service-1", contract_id: "contract-1", property_name: "Casa QA", tipo: "luz", periodicidad: "mensual", aplica: true, quien_paga: "inquilino" };

test("relación contractual distingue exacta, legacy, terminada, ausente y ambigua", () => {
  assert.equal(resolveServiceContractRelation(service, [activeContract], options.today).relation, "active");
  assert.equal(resolveServiceContractRelation({ ...service, contract_id: null }, [activeContract], options.today).relation, "legacy_match");
  assert.equal(resolveServiceContractRelation({ ...service, contract_id: null }, [{ ...activeContract, end_date: "2026-01-31" }], options.today).relation, "ended");
  assert.equal(resolveServiceContractRelation({ ...service, contract_id: null }, [], options.today).relation, "missing");
  assert.equal(resolveServiceContractRelation({ ...service, contract_id: null }, [activeContract, { ...activeContract, id: "contract-2" }], options.today).relation, "ambiguous");
});

test("mensual sin fila es control faltante, mientras fechas reales definen próximo o vencido", () => {
  const missing = buildAdministrativeWorkCenter(base(service, [], [activeContract]), options).items[0];
  assert.equal(missing.ruleKey, "servicio_periodo_sin_control");
  assert.equal(missing.bucket, "para_hoy");
  const due = (id, date) => ({ id, servicio_id: service.id, property_name: "Casa QA", tipo: "luz", periodo: "2026-08", status: "pendiente", fecha_limite: date });
  assert.equal(buildAdministrativeWorkCenter(base(service, [due("next", "2026-08-20")], [activeContract]), options).items[0].ruleKey, "servicio_proximo");
  assert.equal(buildAdministrativeWorkCenter(base(service, [due("late", "2026-08-17")], [activeContract]), options).items[0].ruleKey, "servicio_vencido");
});

test("bimestral y anual derivan ancla sólo de historial verificable", () => {
  for (const [frequency, priorPeriod, priorDue, expected] of [["bimestral", "2026-06", "2026-06-20", "2026-08"], ["anual", "2025-08", "2025-08-20", "2026-08"]]) {
    const configured = { ...service, periodicidad: frequency };
    const withoutAnchor = buildAdministrativeWorkCenter(base(configured, [], [activeContract]), options).items[0];
    assert.equal(withoutAnchor.presentationCategory, "data_quality");
    const withAnchor = buildAdministrativeWorkCenter(base(configured, [{ id: `${frequency}-anchor`, servicio_id: service.id, periodo: priorPeriod, fecha_limite: priorDue, status: "pagado" }], [activeContract]), options).items[0];
    assert.equal(withAnchor.metadata.expectedPeriod, expected);
    assert.equal(withAnchor.ruleKey, "servicio_proximo");
  }
});

test("recarga no inventa obligación e histórico no figura como deuda", () => {
  assert.equal(buildAdministrativeWorkCenter(base({ ...service, periodicidad: "recarga" }, [], [activeContract]), options).items.length, 0);
  const historic = buildAdministrativeWorkCenter(base({ ...service, contract_id: null }, [], [{ ...activeContract, status: "terminado", end_date: "2026-01-31" }]), options).items.find((item) => item.sourceType === "servicios");
  assert.equal(historic.presentationCategory, "historical_review");
  assert.equal(historic.ruleKey, "servicio_historico_revisar");
});

test("calidad de datos no infla autorización financiera y conserva metadata segura", () => {
  const quality = buildAdministrativeWorkCenter(base({ ...service, contract_id: null, periodicidad: "bimestral" }, [], []), options);
  assert.equal(quality.summary.data_quality, 1);
  assert.equal(quality.summary.requiere_autorizacion, 0);
  assert.equal(quality.items[0].metadata.serviceId, "service-1");
  assert.doesNotMatch(JSON.stringify(quality), /email|phone|receipt_url|comprobante_url|firma_url/i);
});

test("firma crítica absorbe su cita vencida como contexto", () => {
  const result = buildAdministrativeWorkCenter({
    firmas: [{ id: "signature-1", status: "activo", etapa_actual: 1, updated_at: "2026-07-01T00:00:00Z" }],
    firmas_citas: [{ id: "appointment-1", firma_id: "signature-1", fecha: "2026-08-17", hora: "12:00", status: "programada" }],
  }, options);
  const signatureItems = result.items.filter((item) => item.metadata?.signatureId === "signature-1");
  assert.equal(signatureItems.length, 1);
  assert.equal(signatureItems[0].metadata.appointmentContext.appointmentId, "appointment-1");
});

test("UI separa calidad, ofrece detalle y destinos consumen parámetros", async () => {
  assert.match(ui, /Datos incompletos/);
  assert.match(ui, /Históricos por revisar/);
  assert.match(ui, /Ver detalle/);
  assert.match(ui, /owner_payment_receipts:\s*"Entregas a propietarios"/);
  assert.match(hook, /scrollIntoView/);
  for (const file of ["cobranza.js", "contratos.js", "mantenimiento.js"]) {
    const page = await readFile(new URL(`../pages/${file}`, import.meta.url), "utf8");
    assert.match(page, /useContextualRecord/);
  }
});
