import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const api = await readFile(new URL("../pages/api/operaciones/work-center.js", import.meta.url), "utf8");

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
