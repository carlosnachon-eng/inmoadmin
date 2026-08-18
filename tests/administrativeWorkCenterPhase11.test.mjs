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
const hookFunctions = hook
  .replace('import { useEffect, useRef } from "react";\n', "")
  .replace(/export function useContextualRecord[\s\S]*?\n}\n\nexport const contextualRecordStyle[\s\S]*?\n  : \{};\n/, "")
  .replace("export function resolveServiceDeepLinkContext", "function resolveServiceDeepLinkContext")
  + "\nexport { resolveServiceDeepLinkContext };";
const { resolveServiceDeepLinkContext } = await import(`data:text/javascript;base64,${Buffer.from(hookFunctions).toString("base64")}`);
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
  assert.equal(signatureItems[0].sourceType, "firmas");
  assert.equal(signatureItems[0].contextKey, "administrative:firmas:signature-1:rule:firma_sin_avance");
  assert.equal(signatureItems[0].href, "/firmas/signature-1?appointmentId=appointment-1");
  assert.equal(signatureItems[0].metadata.appointmentContext.appointmentId, "appointment-1");
});

test("firma crítica no absorbe una cita futura", () => {
  const result = buildAdministrativeWorkCenter({
    firmas: [{ id: "signature-1", status: "activo", etapa_actual: 1, updated_at: "2026-07-01T00:00:00Z" }],
    firmas_citas: [{ id: "appointment-future", firma_id: "signature-1", fecha: "2026-08-20", hora: "12:00", status: "programada" }],
  }, options);
  const signatureItems = result.items.filter((item) => item.metadata?.signatureId === "signature-1");
  assert.equal(signatureItems.length, 2);
  assert.equal(signatureItems.find((item) => item.sourceType === "firmas").href, "/firmas/signature-1");
  assert.equal(signatureItems.find((item) => item.sourceType === "firmas_citas").href, "/firmas/signature-1?appointmentId=appointment-future");
});

test("cita vencida sin firma crítica conserva su propia navegación", () => {
  const result = buildAdministrativeWorkCenter({
    firmas: [{ id: "signature-1", status: "activo", etapa_actual: 1, updated_at: "2026-08-18T12:00:00Z" }],
    firmas_citas: [{ id: "appointment-overdue", firma_id: "signature-1", fecha: "2026-08-17", hora: "12:00", status: "programada" }],
  }, options);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceType, "firmas_citas");
  assert.equal(result.items[0].href, "/firmas/signature-1?appointmentId=appointment-overdue");
});

test("múltiples citas vencidas eligen determinísticamente la más reciente", () => {
  const build = (firmas_citas) => buildAdministrativeWorkCenter({
    firmas: [{ id: "signature-1", status: "activo", etapa_actual: 1, updated_at: "2026-07-01T00:00:00Z" }],
    firmas_citas,
  }, options).items.find((item) => item.sourceType === "firmas");
  const appointments = [
    { id: "appointment-old", firma_id: "signature-1", fecha: "2026-08-15", hora: "12:00", status: "programada" },
    { id: "appointment-recent", firma_id: "signature-1", fecha: "2026-08-17", hora: "12:00", status: "programada" },
  ];
  const forward = build(appointments);
  const reverse = build(appointments.slice().reverse());
  assert.equal(forward.href, "/firmas/signature-1?appointmentId=appointment-recent");
  assert.equal(reverse.href, forward.href);
  assert.deepEqual(reverse.metadata.appointmentContext, forward.metadata.appointmentContext);
});

test("UI separa calidad, ofrece detalle y destinos consumen parámetros", async () => {
  assert.match(ui, /Datos incompletos/);
  assert.match(ui, /Históricos por revisar/);
  assert.match(ui, /Ver detalle/);
  assert.match(ui, /Cita contextual/);
  assert.match(ui, /appointmentContext\.dueAt/);
  assert.match(ui, /owner_payment_receipts:\s*"Entregas a propietarios"/);
  assert.match(hook, /scrollIntoView/);
  for (const file of ["cobranza.js", "contratos.js", "mantenimiento.js"]) {
    const page = await readFile(new URL(`../pages/${file}`, import.meta.url), "utf8");
    assert.match(page, /useContextualRecord/);
  }
});

test("deep link de servicio abre servicio y periodo aunque no exista pago", () => {
  const context = resolveServiceDeepLinkContext(
    { serviceId: "service-x", period: "2026-08" },
    [{ id: "service-x", tipo: "luz" }],
    [],
  );
  assert.equal(context.service.id, "service-x");
  assert.equal(context.period, "2026-08");
  assert.equal(context.payment, null);
  assert.equal(context.tab, "estado");
});

test("deep link de servicio selecciona el pago exacto", () => {
  const context = resolveServiceDeepLinkContext(
    { serviceId: "service-x", period: "2026-08", paymentId: "payment-y" },
    [{ id: "service-x", tipo: "agua" }],
    [{ id: "payment-y", periodo: "2026-08", tipo: "agua" }],
  );
  assert.equal(context.payment.id, "payment-y");
  assert.equal(context.tab, "historial");
  assert.equal(context.paymentMissing, false);
});

test("paymentId inexistente conserva el contexto del servicio sin romper", () => {
  const context = resolveServiceDeepLinkContext(
    { serviceId: "service-x", period: "2026-08", paymentId: "missing" },
    [{ id: "service-x", tipo: "predial" }],
    [],
  );
  assert.equal(context.service.id, "service-x");
  assert.equal(context.payment, null);
  assert.equal(context.paymentMissing, true);
  assert.equal(context.tab, "estado");
});

test("sin query params conserva el comportamiento histórico", () => {
  assert.deepEqual(resolveServiceDeepLinkContext({}, [{ id: "service-x" }], [{ id: "payment-y" }]), {
    serviceId: "", paymentId: "", period: "", service: null, payment: null, tab: "estado", paymentMissing: false,
  });
});

test("cada destino profundo consume y enfoca su identificador", async () => {
  const expectations = new Map([
    ["cobranza.js", ["paymentId", "useContextualRecord"]],
    ["contratos.js", ["contractId", "useContextualRecord"]],
    ["checador.js", ["keyId", "useContextualRecord"]],
    ["liquidaciones.js", ["ownerId", "receiptId", "setExpedienteTab(\"comprobantes\")"]],
    ["mantenimiento.js", ["ticketId", "quoteId", "useContextualRecord"]],
    ["condominio/[id].js", ["unitId", "feeId", "period"]],
    ["poliza/index.js", ["expedienteId", "seleccionarExpediente"]],
    ["firmas/[id].js", ["appointmentId", "firma_citas"]],
    ["propiedades.js", ["serviceId", "paymentId", "filtroPeriodo"]],
  ]);
  for (const [file, needles] of expectations) {
    const page = await readFile(new URL(`../pages/${file}`, import.meta.url), "utf8");
    for (const needle of needles) assert.ok(page.includes(needle), `${file} debe consumir ${needle}`);
  }
});
