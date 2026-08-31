import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const api = await readFile(new URL("../pages/api/operaciones/work-center.js", import.meta.url), "utf8");
const ui = await readFile(new URL("../pages/mi-trabajo-administrativo.js", import.meta.url), "utf8");

test("cada fuente se aísla y la respuesta reporta carga parcial", () => {
  assert.match(api, /try\s*\{[\s\S]*fetchAllPages[\s\S]*\}\s*catch/s);
  assert.match(api, /Promise\.all\(Object\.entries\(SOURCE_QUERIES\)/);
  assert.match(api, /sourcesWithError\.push/);
  assert.match(api, /sourcesWithError,/);
});

test("consultas server-side seleccionan sólo campos necesarios de evidencia", () => {
  assert.match(api, /pagos_servicios[\s\S]*comprobante_url/);
  assert.match(api, /sanitizeAdministrativeSourceRows/);
  assert.doesNotMatch(api, /\.select\("\*"\)/);
});

test("liquidaciones cargan receptor transaccional y evidencia de caja", () => {
  assert.match(api, /payments[\s\S]*recibido_por/);
  assert.match(api, /cash_movements[\s\S]*renta_cobrada/);
});

test("consulta resueltos es explícita y conserva activos por defecto", () => {
  assert.match(api, /req\.query\.status === "resolved"/);
  assert.match(api, /buildAdministrativeWorkCenter\(sources, \{ caseStatus \}\)/);
  assert.match(api, /caseStatus,/);
});

test("aprobaciones usan las columnas reales del schema durable", () => {
  assert.match(api, /requested_capability,risk_tier,status,reason_safe,created_at,expires_at/);
  assert.doesNotMatch(api, /work_item_id,approval_type/);
});

test("deep link durable abre el detalle y tolera ausencia de ruleKey", () => {
  assert.match(ui, /new URLSearchParams\(window\.location\.search\)\.get\("workItemId"\)/);
  assert.match(ui, /candidate\.durableWorkItemId === workItemId/);
  assert.match(ui, /selectedItem\.ruleKey \?/);
  assert.match(ui, /"Trabajo durable"/);
});
