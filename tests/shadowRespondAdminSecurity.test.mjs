import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bootstrap = await readFile(new URL("../supabase/dev/bootstrap/202608190002_fase_2a_p1_respond_admin_provider.sql", import.meta.url), "utf8");
const rollback = await readFile(new URL("../supabase/dev/rollback/202608190002_fase_2a_p1_respond_admin_provider_rollback.sql", import.meta.url), "utf8");
const checks = await readFile(new URL("../supabase/dev/tests/202608190002_fase_2a_p1_respond_admin_provider_tests.sql", import.meta.url), "utf8");
const adapter = await readFile(new URL("../lib/shadow/providers/respondAdmin.js", import.meta.url), "utf8");
const webhook = await readFile(new URL("../pages/api/webhooks/respond.js", import.meta.url), "utf8");

test("bootstrap P1 es DEV-only, incremental y mantiene ingesta sólo service_role", () => {
  assert.match(bootstrap, /hjfwjnejbcpmknvfpdcq/);
  assert.match(bootstrap, /Produccion bloqueada: bnzrnizrmonjxlktbhlp/);
  assert.match(bootstrap, /dev-bootstrap:202608180005:fase-2a-p0-shadow/);
  assert.match(bootstrap, /respond_admin/);
  assert.match(bootstrap, /outbound_human/);
  assert.match(bootstrap, /revoke all on function public\.ingest_shadow_message\(jsonb,jsonb\) from public, anon, authenticated/);
  assert.match(bootstrap, /grant execute on function public\.ingest_shadow_message\(jsonb,jsonb\) to service_role/);
  assert.match(bootstrap, /payload_fingerprint=p_envelope->>'payloadFingerprint'/);
  assert.match(bootstrap, /external_event_id=p_envelope->>'externalEventId'/);
  assert.match(bootstrap, /return jsonb_build_object\('status','duplicate','messageId',v_existing\)/);
  assert.doesNotMatch(bootstrap, /using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(bootstrap, /insert\s+into\s+(?!public\.shadow_)/i);
});

test("rollback no borra datos y exige ownership antes de restaurar P0", () => {
  assert.match(rollback, /ownership DEV no comprobado/);
  assert.match(rollback, /existen datos respond_admin/);
  assert.doesNotMatch(rollback, /\bdelete\b|\btruncate\b|drop table/i);
  assert.match(rollback, /provider in \('synthetic','respond','meta','bsp'\)/);
  assert.match(rollback, /direction in \('inbound','outbound'\)/);
});

test("checks SQL validan constraints y grants cerrados", () => {
  assert.match(checks, /respond_admin/);
  assert.match(checks, /outbound_human/);
  assert.match(checks, /has_function_privilege\('anon'/);
  assert.match(checks, /has_function_privilege\('authenticated'/);
  assert.match(checks, /has_function_privilege\('service_role'/);
});

test("adapter no tiene capacidad outbound y el fork ocurre después de encolar Ventas", () => {
  assert.doesNotMatch(adapter, /respondRequest|fetch\(|sendMessage|axios|openai|anthropic/i);
  const insertIndex = webhook.indexOf('.from("gv_respond_webhook_events").insert');
  const forkIndex = webhook.lastIndexOf("captureRespondAdminShadowIsolated(admin, body)");
  assert.ok(insertIndex >= 0 && forkIndex > insertIndex);
});
