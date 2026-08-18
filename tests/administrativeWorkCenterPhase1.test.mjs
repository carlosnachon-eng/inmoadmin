import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workSource = await readFile(new URL("../lib/operaciones/administrativeWorkCenter.js", import.meta.url), "utf8");
const ownerSource = await readFile(new URL("../lib/operaciones/ownerLiquidation.js", import.meta.url), "utf8");
const liquidationPageSource = await readFile(new URL("../pages/liquidaciones.js", import.meta.url), "utf8");
const loadable = workSource.replace(
  'import { calculateOwnerLiquidation, maintenanceOwnerBalance } from "./ownerLiquidation.js";',
  ownerSource.replaceAll("export function", "function"),
);
const { buildAdministrativeWorkCenter, sanitizeAdministrativeSourceRows } = await import(
  `data:text/javascript;base64,${Buffer.from(loadable).toString("base64")}`
);
const { calculateOwnerLiquidation, paymentReceivedByEmporio } = await import(
  `data:text/javascript;base64,${Buffer.from(ownerSource).toString("base64")}`
);

const options = { today: "2026-08-18", now: new Date("2026-08-18T18:00:00Z") };
const service = { id: "service-1", property_name: "Casa A", tipo: "luz", periodicidad: "mensual", aplica: true, quien_paga: "inquilino" };

test("servicio sin pago esperado, próximo, vencido y en revisión", () => {
  const missing = buildAdministrativeWorkCenter({ servicios_inmueble: [service] }, options).items[0];
  assert.equal(missing.ruleKey, "servicio_periodo_sin_control");
  assert.equal(missing.bucket, "vencido");

  const next = buildAdministrativeWorkCenter({ servicios_inmueble: [service], pagos_servicios: [{ id: "p1", property_name: "Casa A", tipo: "luz", periodo: "2026-08", status: "pendiente", fecha_limite: "2026-08-22" }] }, options).items[0];
  assert.equal(next.ruleKey, "servicio_proximo");
  assert.equal(next.bucket, "proximo");

  const overdue = buildAdministrativeWorkCenter({ servicios_inmueble: [service], pagos_servicios: [{ id: "p2", property_name: "Casa A", tipo: "luz", periodo: "2026-08", status: "pendiente", fecha_limite: "2026-08-17" }] }, options).items[0];
  assert.equal(overdue.ruleKey, "servicio_vencido");

  const review = buildAdministrativeWorkCenter({ servicios_inmueble: [service], pagos_servicios: [{ id: "p3", property_name: "Casa A", tipo: "luz", periodo: "2026-08", status: "en_revision", hasReceipt: true, fecha_limite: "2026-08-01" }] }, options).items[0];
  assert.equal(review.ruleKey, "comprobante_servicio_pendiente");
  assert.match(review.recommendedAction, /Validar/);
});

test("periodicidades no inventan faltantes para bimestral, anual o recarga", () => {
  for (const periodicidad of ["bimestral", "anual"]) {
    const [item] = buildAdministrativeWorkCenter({
      servicios_inmueble: [{ ...service, id: `service-${periodicidad}`, periodicidad }],
    }, options).items;
    assert.equal(item.ruleKey, "servicio_datos_inconsistentes");
    assert.equal(item.bucket, "requiere_autorizacion");
    assert.ok(item.dataQuality.missingFields.includes("proximo_periodo_esperado"));
    assert.notEqual(item.ruleKey, "servicio_periodo_sin_control");
  }
  const recharge = buildAdministrativeWorkCenter({
    servicios_inmueble: [{ ...service, id: "service-recharge", tipo: "gas_recarga", periodicidad: "recarga" }],
  }, options);
  assert.equal(recharge.items.length, 0);
});

const liquidationSources = (ownerPayments = [], tickets = [], overrides = {}) => ({
  properties: [{ id: "prop-1", name: "Casa A", owner_email: "owner@example.com" }],
  contracts: [{ id: "contract-1", property_name: "Casa A", start_date: "2026-01-01", end_date: "2026-12-31", monthly_rent: 10000, commission_type: "porcentaje", commission_value: 10, rent_receiver: "inmobiliaria", ...overrides.contract }],
  payments: [{ id: "rent-1", contract_id: "contract-1", property_name: "Casa A", due_date: "2026-08-05", status: "pagado", amount: 10000, ...overrides.payment }],
  owner_payments: ownerPayments,
  maintenance_tickets: tickets,
  cash_movements: overrides.cashMovements || [],
});

test("liquidación pendiente y parcial usan el mismo cálculo determinístico", () => {
  const pending = buildAdministrativeWorkCenter(liquidationSources(), options).items.find((i) => i.sourceType === "owner_liquidations");
  assert.equal(pending.metadata.balance, 9000);
  assert.equal(pending.ruleKey, "liquidacion_pendiente");
  const partial = buildAdministrativeWorkCenter(liquidationSources([{ owner_email: "owner@example.com", period_description: "agosto de 2026", amount_paid: 3000, status: "pagado_parcial" }]), options).items.find((i) => i.sourceType === "owner_liquidations");
  assert.equal(partial.metadata.balance, 6000);
  assert.equal(partial.ruleKey, "liquidacion_parcial");
  assert.doesNotMatch(JSON.stringify(partial), /owner@example\.com/);
});

test("A: renta recibida por inmobiliaria genera saldo liquidable", () => {
  const item = buildAdministrativeWorkCenter(liquidationSources([], [], {
    payment: { recibido_por: "emporio" },
  }), options).items.find((row) => row.sourceType === "owner_liquidations");
  assert.equal(item.metadata.totalRent, 10000);
  assert.equal(item.metadata.totalCommission, 1000);
  assert.equal(item.metadata.balance, 9000);
});

test("B y C: renta directa no genera saldo pero conserva comisión devengada manual", () => {
  const result = buildAdministrativeWorkCenter(liquidationSources([], [], {
    contract: { rent_receiver: "propietario" },
    payment: { recibido_por: "propietario" },
  }), options);
  assert.equal(result.items.some((row) => row.sourceType === "owner_liquidations"), false);

  const direct = calculateOwnerLiquidation({
    ownerEmail: "owner@example.com",
    period: "2026-08",
    ...liquidationSources([], [], {
      contract: { rent_receiver: "propietario" },
      payment: { recibido_por: "propietario" },
    }),
  });
  assert.equal(direct.totalRent, 0);
  assert.equal(direct.totalRetainableCommission, 0);
  assert.equal(direct.totalCommissionAccrued, 1000);
  assert.equal(direct.balance, 0);
});

test("D: mezcla liquida sólo renta en poder de Emporio y separa comisión manual", () => {
  const mixed = calculateOwnerLiquidation({
    ownerEmail: "owner@example.com",
    period: "2026-08",
    properties: [
      { id: "prop-1", name: "Casa A", owner_email: "owner@example.com" },
      { id: "prop-2", name: "Casa B", owner_email: "owner@example.com" },
    ],
    contracts: [
      { id: "contract-1", property_name: "Casa A", rent_receiver: "inmobiliaria", monthly_rent: 10000, commission_type: "porcentaje", commission_value: 10 },
      { id: "contract-2", property_name: "Casa B", rent_receiver: "propietario", monthly_rent: 8000, commission_type: "porcentaje", commission_value: 10 },
    ],
    payments: [
      { id: "rent-1", contract_id: "contract-1", property_name: "Casa A", due_date: "2026-08-05", status: "pagado", recibido_por: "emporio", amount: 10000 },
      { id: "rent-2", contract_id: "contract-2", property_name: "Casa B", due_date: "2026-08-05", status: "pagado", recibido_por: "propietario", amount: 8000 },
    ],
  });
  assert.equal(mixed.totalRent, 10000);
  assert.equal(mixed.totalRetainableCommission, 1000);
  assert.equal(mixed.totalCommissionAccrued, 1800);
  assert.equal(mixed.balance, 9000);
});

test("payments.recibido_por prevalece y caja respalda el histórico directo cobrado en oficina", () => {
  const directContract = { id: "c", property_name: "Casa A", rent_receiver: "propietario" };
  assert.equal(paymentReceivedByEmporio({ amount: 10000, property_name: "Casa A", recibido_por: "propietario" }, directContract, [{ type: "entrada", category: "renta_cobrada", description: "Casa A", amount: 10000, date: "2026-08-05" }], "2026-08"), false);
  assert.equal(paymentReceivedByEmporio({ amount: 10000, property_name: "Casa A", recibido_por: "emporio" }, directContract, [], "2026-08"), true);
  assert.equal(paymentReceivedByEmporio({ amount: 10000, property_name: "Casa A" }, directContract, [{ type: "entrada", category: "renta_cobrada", description: "Renta Casa A", amount: 10000, date: "2026-08-05" }], "2026-08"), true);
});

test("la pantalla reutiliza el cálculo y no vuelve a descontar parciales", () => {
  assert.match(liquidationPageSource, /calculateOwnerLiquidation\(/);
  assert.doesNotMatch(liquidationPageSource, /pendienteTotal\s*-\s*yaAbonado/);
  assert.doesNotMatch(liquidationPageSource, /calcPendienteMes\(propietarioPago\.email\)\s*-\s*pagoYaAbonado/);
});

test("mantenimiento anterior pendiente genera seguimiento de descuento", () => {
  const result = buildAdministrativeWorkCenter(liquidationSources([], [{ id: "ticket-1", property_name: "Casa A", payer: "propietario", charged_amount: 1200, advance_paid: true, advance_amount: 200, descontado_de_liquidacion: false, created_at: "2026-07-02T12:00:00Z", status: "terminado" }]), options);
  const item = result.items.find((i) => i.ruleKey === "mantenimiento_propietario_pendiente_descuento");
  assert.equal(item.metadata.balance, 1000);
});

test("llave fuera de resguardo replica el umbral de un día", () => {
  const result = buildAdministrativeWorkCenter({ llaves: [{ id: "key-1", numero: 7, propiedad: "Casa A", portador_nombre: "Persona", activa: true, en_resguardo: false, fecha_prestamo: "2026-08-16T18:00:00Z" }] }, options);
  assert.equal(result.items[0].ruleKey, "llave_fuera_resguardo");
  assert.equal(result.items[0].metadata.daysOut, 2);
});

test("sanitiza todas las URLs de comprobantes", () => {
  for (const source of ["payments", "pagos_servicios", "owner_payment_receipts"]) {
    const [row] = sanitizeAdministrativeSourceRows(source, [{ id: "x", receipt_url: "https://private/rent", comprobante_url: "https://private/service", firma_url: "https://private/sign" }]);
    assert.equal(row.hasReceipt, true);
    assert.doesNotMatch(JSON.stringify(row), /https:\/\/private/);
  }
});

test("comprobante de entrega incompleto sólo expone booleanos", () => {
  const [receipt] = sanitizeAdministrativeSourceRows("owner_payment_receipts", [{ id: "receipt-1", forma_pago: "transferencia", comprobante_url: null, firma_url: "https://private/wrong-evidence" }]);
  const item = buildAdministrativeWorkCenter({ owner_payment_receipts: [receipt] }, options).items[0];
  assert.equal(item.ruleKey, "evidencia_entrega_incompleta");
  assert.equal(item.metadata.hasReceipt, true);
  assert.doesNotMatch(JSON.stringify(item), /private|firma_url|comprobante_url/);
});

test("supervisión corrige, filtra resueltos y conserva deduplicación", () => {
  const sources = { llaves: [{ id: "key-1", numero: 7, propiedad: "Casa A", portador_nombre: "Persona", activa: true, en_resguardo: false, fecha_prestamo: "2026-08-16T18:00:00Z" }] };
  const base = buildAdministrativeWorkCenter(sources, options).items[0];
  const corrected = buildAdministrativeWorkCenter({ ...sources, administrative_case_controls: [{ context_key: base.contextKey, corrected_bucket: "para_hoy", corrected_priority: "P2", resolution_status: "open", manual_control: true }] }, options).items;
  assert.equal(corrected.length, 1);
  assert.equal(corrected[0].bucket, "para_hoy");
  assert.equal(corrected[0].supervision.manualControl, true);
  const resolved = buildAdministrativeWorkCenter({ ...sources, administrative_case_controls: [{ context_key: base.contextKey, resolution_status: "resolved" }] }, options);
  assert.equal(resolved.items.length, 0);
});
