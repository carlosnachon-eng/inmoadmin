import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

test("schema no almacena PII y audita actor, TTL, consumo, revocación y run", () => {
  const sql = read("supabase/migrations/202608220001_fase_2a_shadow_ai_manual_authorizations.sql");
  for (const column of ["authorization_id","message_id","authorized_by","authorized_at","expires_at","consumed_at","revoked_at","purpose","ai_run_id"]) assert.match(sql, new RegExp(`\\b${column}\\b`));
  assert.doesNotMatch(sql, /message_text|sanitized_text|raw_payload|contact_hash|phone|email/i);
  assert.match(sql, /purpose = 'real_shadow_manual'/);
});

test("doble consumo tiene un solo ganador y enlaza exactamente el run compatible", () => {
  const sql = read("supabase/migrations/202608220001_fase_2a_shadow_ai_manual_authorizations.sql");
  assert.match(sql, /consumed_at is null and a\.revoked_at is null and a\.expires_at > clock_timestamp\(\)/);
  assert.match(sql, /r\.id=p_ai_run_id and r\.message_id=p_message_id and r\.model=p_model/);
  assert.match(sql, /manual_authorization_not_consumable/);
  assert.match(sql, /unique index shadow_ai_manual_authorizations_run_uidx/);
});

test("creación concurrente se serializa y TTL se limita a quince minutos", () => {
  const sql = read("supabase/migrations/202608220001_fase_2a_shadow_ai_manual_authorizations.sql");
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /p_ttl_seconds < 60 or p_ttl_seconds > 900/);
  assert.match(sql, /manual_authorization_already_active/);
});

test("RLS y RPC permiten escritura sólo server-side", () => {
  const sql = read("supabase/migrations/202608220001_fase_2a_shadow_ai_manual_authorizations.sql");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all .* public, anon, authenticated/);
  assert.match(sql, /grant all .* service_role/);
  assert.match(sql, /grant execute .* service_role/);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
});

test("run consume autorización después de crear run y antes de llamar provider", () => {
  const machine = read("lib/shadow/ai/stateMachine.js");
  const realRun = read("lib/shadow/ai/realRun.js");
  assert.ok(machine.indexOf("beforeExecuteRun") > machine.indexOf('insert({ message_id: messageId'));
  assert.ok(machine.indexOf("beforeExecuteRun") < machine.indexOf('executeShadowAiStateStep(admin, run.id'));
  assert.match(realRun, /consumeManualRealAuthorization/);
  assert.match(realRun, /authorizationId/);
});

test("continuation conserva el mismo run y no pide nueva autorización", () => {
  const continuation = read("pages/api/operaciones/shadow-ai-real-continue.js");
  assert.match(continuation, /runId/);
  assert.doesNotMatch(continuation, /authorizationId/);
  assert.match(read("lib/shadow/ai/realRun.js"), /run\.prompt_version !== REAL_SHADOW_AI_PROMPT_VERSION/);
});

test("no existe disparo automático, write tool, outbound ni llamada Respond", () => {
  const sources = [
    read("pages/api/operaciones/shadow-ai-real-authorize.js"),
    read("pages/api/operaciones/shadow-ai-real-run.js"),
    read("pages/api/operaciones/shadow-ai-real-revoke.js"),
    read("lib/shadow/ai/manualAuthorization.js"),
  ].join("\n");
  assert.doesNotMatch(sources, /cron|webhook|setInterval|sendMessage|respond\.io|maintenance_tickets.*(?:insert|update)/i);
  assert.match(read("lib/shadow/ai/manualAuthorization.js"), /SHADOW_OUTBOUND_ENABLED === "true"/);
});

test("rollback productivo preserva auditoría", () => {
  const rollback = read("supabase/production/rollback/202608220001_fase_2a_shadow_ai_manual_authorizations_rollback.sql");
  assert.match(rollback, /Rollback refused: manual authorization audit rows exist/);
  assert.ok(rollback.indexOf("raise exception") < rollback.indexOf("drop table"));
});
