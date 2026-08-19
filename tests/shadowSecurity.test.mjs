import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../supabase/dev/bootstrap/202608180005_fase_2a_p0_shadow_schema.sql", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../pages/api/operaciones/shadow-coordinator.js", import.meta.url), "utf8");
const ingest = fs.readFileSync(new URL("../pages/api/operaciones/shadow-synthetic-ingest.js", import.meta.url), "utf8");

test("RLS y grants P0 no abren anon ni policies universales", () => {
  assert.match(sql, /enable row level security/); assert.match(sql, /revoke all .* anon/);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i); assert.doesNotMatch(sql, /with check\s*\(\s*true\s*\)/i);
  assert.match(sql, /admin','coord_operaciones/); assert.match(sql, /grant execute .*service_role/);
});

test("API sólo permite evaluación shadow y ruta sintética exige DEV", () => {
  assert.match(api, /shadow_human_evaluations/); assert.doesNotMatch(api, /payments|contracts|cash_movements/);
  assert.match(ingest, /DEV_PROJECT_REF/); assert.match(ingest, /SHADOW_SYNTHETIC_INGEST_ENABLED/);
  assert.doesNotMatch(ingest, /RESPOND_IO_TOKEN|fetch\([^)]*respond/i);
});

test("no existe capacidad de envío ni LLM en P0", () => {
  const all = `${api}\n${ingest}`;
  assert.doesNotMatch(all, /openai|chat\.completions|responses\.create|sendMessage|message\.send/i);
});
