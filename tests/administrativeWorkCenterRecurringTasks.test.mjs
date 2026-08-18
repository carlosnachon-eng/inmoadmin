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
const { buildAdministrativeWorkCenter, recurringTaskItems } = await import(
  `data:text/javascript;base64,${Buffer.from(loadableSource).toString("base64")}`
);

const NOW = new Date("2026-08-12T18:00:00Z");
const task = (suffix, changes = {}) => ({
  id: `2a221000-0000-4000-8000-${suffix}`,
  title: "Tarea QA",
  category: "limpieza",
  responsible_profile_id: "00000000-0000-4000-8000-000000000003",
  property_id: "2a220000-0000-4000-8000-000000000001",
  condominium_id: null,
  recurrence_unit: "week",
  recurrence_interval: 1,
  recurrence_weekday: 3,
  recurrence_month_day: null,
  timezone: "America/Mexico_City",
  next_due_at: "2026-08-12T15:00:00Z",
  lead_days: 7,
  state: "active",
  last_completed_at: null,
  responsible: { id: "00000000-0000-4000-8000-000000000003", active: true },
  ...changes,
});

test("deriva vencido, para hoy y próximo con P1/P2", () => {
  const rows = [
    task("000000000001", { next_due_at: "2026-08-10T15:00:00Z" }),
    task("000000000002"),
    task("000000000003", { next_due_at: "2026-08-15T15:00:00Z" }),
  ];
  const items = recurringTaskItems(rows, NOW);
  const byId = new Map(items.map((item) => [item.sourceId, item]));
  assert.deepEqual(
    rows.map((row) => [byId.get(row.id).bucket, byId.get(row.id).priority]),
    [["vencido", "P1"], ["para_hoy", "P1"], ["proximo", "P2"]],
  );
});

test("lead_days excluye una tarea todavía fuera de anticipación", () => {
  assert.equal(recurringTaskItems([
    task("000000000004", { next_due_at: "2026-08-20T15:00:00Z", lead_days: 7 }),
  ], NOW).length, 0);
});

test("suspendida y desactivada no aparecen", () => {
  assert.equal(recurringTaskItems([
    task("000000000005", { state: "suspended" }),
    task("000000000006", { state: "disabled" }),
  ], NOW).length, 0);
});

test("responsable inactivo conserva la tarea y marca calidad", () => {
  const [item] = recurringTaskItems([
    task("000000000007", { responsible: { id: "qa-inactive", active: false } }),
  ], NOW);
  assert.equal(item.dataQuality.status, "partial");
  assert.deepEqual(item.dataQuality.missingFields, ["responsibleProfileActive"]);
  assert.equal(item.metadata.responsibleActive, false);
  assert.match(item.recommendedAction, /Reasignar/);
});

test("contextKey identifica la ocurrencia y el deep link apunta al módulo fuente", () => {
  const row = task("000000000008");
  const [item] = recurringTaskItems([row], NOW);
  assert.equal(item.contextKey, `operational-recurring:${row.id}:due:${row.next_due_at}`);
  assert.equal(item.href, `/operaciones/tareas-recurrentes?task=${row.id}`);
  assert.equal(item.sourceType, "operational_recurring_task");
  assert.equal(item.ruleKey, "scheduled_occurrence_due");
});

test("deduplica por contextKey dentro del Centro Operativo", () => {
  const row = task("000000000009");
  const result = buildAdministrativeWorkCenter({ operational_recurring_tasks: [row, { ...row }] }, { now: NOW });
  assert.equal(result.items.filter((item) => item.sourceType === "operational_recurring_task").length, 1);
});

test("Work Center no expone instrucciones, proveedor ni evidence path", () => {
  const row = task("000000000010", {
    instructions: "contenido privado",
    provider_name: "proveedor privado",
    evidence_storage_path: "operational-recurring-evidence/private.pdf",
  });
  const output = JSON.stringify(buildAdministrativeWorkCenter({ operational_recurring_tasks: [row] }, { now: NOW }).items);
  assert.doesNotMatch(output, /contenido privado|proveedor privado|private\.pdf|evidence_storage_path/);
});
