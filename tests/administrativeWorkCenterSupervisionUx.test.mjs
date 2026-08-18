import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../pages/mi-trabajo-administrativo.js", import.meta.url), "utf8");
const api = await readFile(new URL("../pages/api/operaciones/administrative-cases.js", import.meta.url), "utf8");

test("nota usa el flujo existente, límite backend e historial", () => {
  assert.match(page, />Agregar nota</);
  assert.match(page, /maxLength=\{1000\}/);
  assert.match(page, /supervise\(item, "note_added", \{\}, notes\)/);
  assert.match(page, /loadHistory\(item\.contextKey, false\)/);
  assert.match(page, /action\.notes/);
  assert.match(api, /"note_added"/);
  assert.match(api, /String\(req\.body\?\.notes \|\| ""\)\.slice\(0, 1000\)/);
});

test("resueltos se consultan aparte y se reabren con la acción existente", () => {
  assert.match(page, />Resueltos</);
  assert.match(page, /\?status=resolved/);
  assert.match(page, />Reabrir</);
  assert.match(page, /supervise\(item, "reopened"\)/);
  assert.match(page, /setCaseView\("active"\)/);
  assert.match(api, /"reopened"/);
});

test("etiquetas visibles no exponen sourceType técnicos conocidos", () => {
  assert.match(page, /owner_payment_receipts: "Entregas a propietarios"/);
  assert.match(page, /operational_recurring_task: "Mantenimiento programado"/);
  assert.match(page, /condominio_cobranza: "Condominios"/);
  assert.match(page, /cash_movements: "Caja"/);
  assert.match(page, /SOURCE_LABELS\[source\.sourceType\]/);
});

test("la UI y el API mantienen roles administrativos existentes", () => {
  assert.match(page, /\["admin", "coord_operaciones"\]\.includes/);
  assert.match(api, /isAdministrativeWorkCenterRole/);
  assert.match(api, /Supervisión no autorizada/);
});
