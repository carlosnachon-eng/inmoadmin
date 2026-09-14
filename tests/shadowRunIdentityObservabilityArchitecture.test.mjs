import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const api = fs.readFileSync(new URL("../pages/api/operaciones/shadow-coordinator.js", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");

test("la API deriva observabilidad de la evidencia del run y no la expone cruda", () => {
  assert.match(api, /buildShadowRunIdentityObservability/);
  assert.match(api, /tool_results_json/);
  assert.match(api, /tool_results_json: _toolResults/);
  assert.match(api, /runIdentityObservability/);
  assert.doesNotMatch(api, /runIdentityObservability[\s\S]{0,300}resolveConfirmedContactIdentity/);
});

test("la UI ofrece filtros confirmada, 7\/7 y no atribuida en modo lectura", () => {
  assert.match(page, /Observabilidad de identidad por run/);
  assert.match(page, /Identidad confirmada/);
  assert.match(page, /Cohorte 7\/7/);
  assert.match(page, /No atribuidos/);
  assert.doesNotMatch(page, /runIdentityObservability[\s\S]{0,500}(?:POST|insert|update|upsert|delete)/);
});
