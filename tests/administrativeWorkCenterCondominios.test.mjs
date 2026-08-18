import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const moduleSource = await readFile(
  new URL("../lib/operaciones/administrativeWorkCenter.js", import.meta.url),
  "utf8",
);
const ownerSource = await readFile(new URL("../lib/operaciones/ownerLiquidation.js", import.meta.url), "utf8");
const loadableSource = moduleSource.replace(
  'import { calculateOwnerLiquidation, maintenanceOwnerBalance } from "./ownerLiquidation.js";',
  ownerSource.replaceAll("export function", "function"),
);
const {
  buildAdministrativeWorkCenter,
  isAdministrativeWorkCenterRole,
  sanitizeAdministrativeSourceRows,
} = await import(`data:text/javascript;base64,${Buffer.from(loadableSource).toString("base64")}`);

const TODAY = "2026-08-11";
const ACTIVE_CONDO = "2a223000-0000-4000-8000-000000000001";
const INACTIVE_CONDO = "2a223000-0000-4000-8000-000000000002";

const unit = (suffix, condominioId = ACTIVE_CONDO, activo = true) => ({
  id: `2a223000-0000-4000-8000-${suffix}`,
  condominio_id: condominioId,
  activo,
});

const units = {
  due: unit("000000000101"),
  recent: unit("000000000102"),
  old: unit("000000000103"),
  multiple: unit("000000000104"),
  receipt: unit("000000000105"),
  criticalReceipt: unit("000000000106"),
  missing: unit("000000000107"),
  paid: unit("000000000108"),
  inactive: unit("000000000109", ACTIVE_CONDO, false),
  inactiveCondo: unit("000000000110", INACTIVE_CONDO),
};

const fee = ({ id, target, due, amount, status = "pendiente", period = "2026-08", hasReceipt = false }) => ({
  id: `2a223000-0000-4000-8000-${id}`,
  condominio_id: target.condominio_id,
  unidad_id: target.id,
  periodo: period,
  monto: amount,
  status,
  fecha_vencimiento: due,
  hasReceipt,
  created_at: `${due}T12:00:00Z`,
});

const sources = {
  condominios: [
    { id: ACTIVE_CONDO, activo: true },
    { id: INACTIVE_CONDO, activo: false },
  ],
  unidades_condominio: Object.values(units),
  cuotas_condominio: [
    fee({ id: "000000000201", target: units.due, due: "2026-08-09", amount: 1000 }),
    fee({ id: "000000000202", target: units.recent, due: "2026-08-01", amount: 1100, status: "atrasado" }),
    fee({ id: "000000000203", target: units.old, due: "2026-07-07", amount: 1200, status: "atrasado" }),
    fee({ id: "000000000204", target: units.multiple, due: "2026-08-01", amount: 1300, status: "atrasado" }),
    fee({ id: "000000000205", target: units.multiple, due: "2026-07-22", amount: 1400, status: "atrasado", period: "2026-07" }),
    fee({ id: "000000000206", target: units.receipt, due: "2026-08-16", amount: 1500, hasReceipt: true }),
    fee({ id: "000000000207", target: units.criticalReceipt, due: "2026-07-02", amount: 1600, status: "atrasado", hasReceipt: true }),
    fee({ id: "000000000208", target: units.criticalReceipt, due: "2026-06-02", amount: 1700, status: "atrasado", period: "2026-07" }),
    fee({ id: "000000000209", target: units.paid, due: "2026-08-09", amount: 1800, status: "pagado" }),
    fee({ id: "000000000210", target: units.inactive, due: "2026-06-22", amount: 1900, status: "atrasado" }),
    fee({ id: "000000000211", target: units.inactiveCondo, due: "2026-06-12", amount: 2000, status: "atrasado" }),
  ],
};

const build = () => buildAdministrativeWorkCenter(sources, {
  today: TODAY,
  now: new Date("2026-08-11T18:00:00Z"),
});

const byUnit = (result, target) => result.items.find((item) => item.sourceId === target.id);

test("clasifica los siete pendientes útiles sin duplicar unidades", () => {
  const result = build();
  const condoItems = result.items.filter((item) => item.sourceType === "condominio_cobranza");
  assert.equal(condoItems.length, 7);
  assert.equal(new Set(condoItems.map((item) => item.contextKey)).size, 7);
  assert.equal(byUnit(result, units.due).ruleKey, "cuota_vencida");
  assert.equal(byUnit(result, units.recent).ruleKey, "moroso_reciente");
  assert.equal(byUnit(result, units.old).ruleKey, "moroso_critico");
  assert.equal(byUnit(result, units.multiple).ruleKey, "moroso_critico");
  assert.equal(byUnit(result, units.receipt).ruleKey, "comprobante_pendiente_aplicar");
  assert.equal(byUnit(result, units.criticalReceipt).ruleKey, "moroso_critico");
  assert.equal(byUnit(result, units.missing).ruleKey, "cuota_periodo_no_generada");
});

test("calcula saldo, antigüedad y precedencia crítica", () => {
  const result = build();
  const multiple = byUnit(result, units.multiple);
  assert.equal(multiple.bucket, "critico");
  assert.equal(multiple.priority, "P0");
  assert.equal(multiple.metadata.overdueInstallments, 2);
  assert.equal(multiple.metadata.overdueBalance, 2700);
  assert.equal(multiple.metadata.oldestOverdueDueAt, "2026-07-22");
  assert.equal(multiple.metadata.overdueDays, 20);

  const old = byUnit(result, units.old);
  assert.equal(old.metadata.overdueDays, 35);
  assert.equal(old.bucket, "critico");
});

test("exactamente 30 días de antigüedad ya es moroso crítico", () => {
  const boundaryUnit = unit("000000000120");
  const result = buildAdministrativeWorkCenter({
    condominios: [{ id: ACTIVE_CONDO, activo: true }],
    unidades_condominio: [boundaryUnit],
    cuotas_condominio: [
      fee({ id: "000000000220", target: boundaryUnit, due: "2026-07-12", amount: 2100 }),
    ],
  }, { today: TODAY, now: new Date("2026-08-11T18:00:00Z") });

  assert.equal(result.items[0].ruleKey, "moroso_critico");
  assert.equal(result.items[0].priority, "P0");
  assert.equal(result.items[0].metadata.overdueDays, 30);
});

test("crítico con comprobante conserva una sola tarjeta crítica y cambia la acción", () => {
  const result = build();
  const matches = result.items.filter((item) => item.sourceId === units.criticalReceipt.id);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].bucket, "critico");
  assert.equal(matches[0].metadata.hasReceipt, true);
  assert.match(matches[0].recommendedAction, /Validar el comprobante/);
  assert.equal(matches[0].waitingOn, null);
});

test("usa contextKey estable, área, espera y deep link autorizados", () => {
  const item = byUnit(build(), units.recent);
  assert.equal(item.contextKey, `condominio:${ACTIVE_CONDO}:unidad:${units.recent.id}:cobranza`);
  assert.equal(item.responsibleArea, "administracion_condominios");
  assert.equal(item.waitingOn, "condomino");
  assert.equal(item.dueAt, "2026-08-01");
  assert.equal(item.href, `/condominio/${ACTIVE_CONDO}?unitId=${units.recent.id}&period=2026-08&feeId=2a223000-0000-4000-8000-000000000202`);
});

test("cuota no generada queda vencida después del día 10", () => {
  const item = byUnit(build(), units.missing);
  assert.equal(item.bucket, "vencido");
  assert.equal(item.priority, "P1");
  assert.equal(item.dueAt, "2026-08-10");
  assert.equal(item.metadata.hasCurrentPeriodFee, false);
});

test("cuota no generada queda para hoy hasta el día 10", () => {
  const result = buildAdministrativeWorkCenter(sources, {
    today: "2026-08-10",
    now: new Date("2026-08-10T18:00:00Z"),
  });
  const item = byUnit(result, units.missing);

  assert.equal(item.bucket, "para_hoy");
  assert.equal(item.priority, "P1");
});

test("excluye cuota pagada, unidad inactiva y condominio inactivo", () => {
  const result = build();
  assert.equal(byUnit(result, units.paid), undefined);
  assert.equal(byUnit(result, units.inactive), undefined);
  assert.equal(byUnit(result, units.inactiveCondo), undefined);
});

test("descarta la URL del comprobante y conserva solo hasReceipt", () => {
  const sanitized = sanitizeAdministrativeSourceRows("cuotas_condominio", [{
    id: "qa-fee",
    comprobante_url: "https://documents.invalid/private-proof.pdf",
  }]);
  assert.equal(sanitized[0].hasReceipt, true);
  assert.equal(Object.hasOwn(sanitized[0], "comprobante_url"), false);
  assert.doesNotMatch(JSON.stringify(sanitized), /documents\.invalid|private-proof/);
});

test("el contrato de salida no contiene PII ni URLs de documentos", () => {
  const serialized = JSON.stringify(build().items);
  for (const forbidden of [
    "propietario_nombre", "propietario_email", "propietario_telefono",
    "residente_nombre", "residente_email", "residente_telefono",
    "direccion", "comprobante_url",
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden));
});

test("mantiene el gate de roles administrativos", () => {
  assert.equal(isAdministrativeWorkCenterRole("admin"), true);
  assert.equal(isAdministrativeWorkCenterRole("coord_operaciones"), true);
  assert.equal(isAdministrativeWorkCenterRole("asesor"), false);
  assert.equal(isAdministrativeWorkCenterRole("gerente_ventas"), false);
  assert.equal(isAdministrativeWorkCenterRole(null), false);
});
