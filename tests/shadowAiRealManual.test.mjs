import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { REAL_SHADOW_ADMIN_CHANNEL_ID, REAL_SHADOW_DEV_CLONE_MARKER, realShadowDevCloneEligibility, realShadowEnvelope, realShadowMessageEligibility } from "../lib/shadow/ai/realMessage.js";
import { REAL_SHADOW_AI_PROMPT_VERSION, REAL_SHADOW_AI_SYSTEM_PROMPT } from "../lib/shadow/ai/realPrompt.js";
import { assertRealShadowRunEnvironment } from "../lib/shadow/ai/realRun.js";
import { assertManualAuthorizationEnvironment, manualAuthorizationState, REAL_MANUAL_AUTHORIZATION_TTL_SECONDS } from "../lib/shadow/ai/manualAuthorization.js";
import { shadowAiIdempotencyKey } from "../lib/shadow/ai/runner.js";
import { READ_ONLY_SHADOW_TOOLS } from "../lib/shadow/context.js";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const prodEnv = {
  VERCEL_ENV: "production", SUPABASE_ENVIRONMENT: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://bnzrnizrmonjxlktbhlp.supabase.co",
  SHADOW_AI_ENABLED: "false", SHADOW_AI_PRODUCTION_ENABLED: "false", SHADOW_AI_MANUAL_REAL_ENABLED: "true",
  SHADOW_AI_ALLOW_REAL_MESSAGES: "false", SHADOW_AI_ALLOW_OPERATIONAL_EVENTS: "false",
  SHADOW_OUTBOUND_ENABLED: "false", SHADOW_RESPOND_ADMIN_CHANNEL_ID: REAL_SHADOW_ADMIN_CHANNEL_ID,
};
const message = { id: "00000000-0000-4000-8000-000000000001", direction: "inbound", occurred_at: "2026-08-21T12:00:00Z", sanitized_text: "Sigue pendiente el mantenimiento", attachment_metadata: [], provider_metadata: {}, external_message_id: "respond-message-opaque" };
const conversation = { provider: "respond_admin", channel: REAL_SHADOW_ADMIN_CHANNEL_ID };
const devEnv = { VERCEL_ENV: "preview", SUPABASE_ENVIRONMENT: "dev", NEXT_PUBLIC_SUPABASE_URL: "https://hjfwjnejbcpmknvfpdcq.supabase.co", SHADOW_REAL_MANUAL_DEV_TEST_ENABLED: "true", SHADOW_AI_MANUAL_REAL_ENABLED: "true", SHADOW_AI_ENABLED: "false", SHADOW_AI_ALLOW_REAL_MESSAGES: "false", SHADOW_AI_PRODUCTION_ENABLED: "false", SHADOW_AI_ALLOW_OPERATIONAL_EVENTS: "false", SHADOW_OUTBOUND_ENABLED: "false" };
const devClone = { ...message, external_message_id: REAL_SHADOW_DEV_CLONE_MARKER, provider_metadata: { realManualDevClone: REAL_SHADOW_DEV_CLONE_MARKER }, sanitized_text: "El mantenimiento sintético sigue pendiente." };

test("Admin inbound 544519 sanitizado es elegible y se reconstruye sin texto libre", () => {
  assert.deepEqual(realShadowMessageEligibility({ message, conversation, env: prodEnv }), { allowed: true, reason: "eligible" });
  const envelope = realShadowEnvelope(message, conversation);
  assert.equal(envelope.providerMetadata.channelId, REAL_SHADOW_ADMIN_CHANNEL_ID);
  assert.equal(envelope.sanitizedText, message.sanitized_text);
});

test("Ventas, outbound_human, QA y contenido que requiere sanitización fallan cerrado", () => {
  assert.equal(realShadowMessageEligibility({ message, conversation: { ...conversation, channel: "498219" }, env: prodEnv }).allowed, false);
  assert.equal(realShadowMessageEligibility({ message: { ...message, direction: "outbound_human" }, conversation, env: prodEnv }).allowed, false);
  assert.equal(realShadowMessageEligibility({ message: { ...message, provider_metadata: { syntheticScenario: "p3-01" } }, conversation, env: prodEnv }).allowed, false);
  assert.equal(realShadowMessageEligibility({ message: { ...message, sanitized_text: "correo cliente@example.com" }, conversation, env: prodEnv }).allowed, false);
});

test("clone DEV exacto es elegible sin relajar mensajes reales ni Production", () => {
  assert.deepEqual(realShadowDevCloneEligibility({ message: devClone, conversation, env: devEnv }), { allowed: true, reason: "eligible_dev_clone" });
  assert.equal(realShadowDevCloneEligibility({ message, conversation, env: devEnv }).allowed, false);
  assert.equal(realShadowDevCloneEligibility({ message: devClone, conversation, env: prodEnv }).allowed, false);
  assert.equal(realShadowDevCloneEligibility({ message: devClone, conversation: { ...conversation, channel: "498219" }, env: devEnv }).allowed, false);
  assert.equal(realShadowDevCloneEligibility({ message: { ...devClone, direction: "outbound_human" }, conversation, env: devEnv }).allowed, false);
  assert.equal(realShadowDevCloneEligibility({ message: { ...devClone, provider_metadata: { syntheticScenario: "p3-01" } }, conversation, env: devEnv }).allowed, false);
  assert.equal(realShadowDevCloneEligibility({ message: devClone, conversation, env: { ...devEnv, SHADOW_OUTBOUND_ENABLED: "true" } }).allowed, false);
});

test("clone persistido conserva marker hasta coordinator y habilita exclusivamente la UI DEV-test", () => {
  const coordinator = read("pages/api/operaciones/shadow-coordinator.js");
  const ui = read("pages/coordinador-ia-sombra.js");
  assert.match(coordinator, /select\("[^"]*external_message_id[^"]*"\)/);
  const eligibility = realShadowDevCloneEligibility({ message: devClone, conversation, env: devEnv });
  const realShadow = { eligible: eligibility.allowed, devTest: eligibility.allowed, reason: eligibility.reason };
  assert.deepEqual(realShadow, { eligible: true, devTest: true, reason: "eligible_dev_clone" });
  assert.match(coordinator, /real_shadow: \{/);
  assert.match(ui, /selected\.real_shadow\?\.devTest/);
  assert.match(ui, /selected\.real_shadow\?\.eligible/);
  assert.match(ui, />DEV TEST/);
  assert.match(ui, />Analizar en Shadow</);
});

test("guard productivo exige kill switch manual y mantiene flags globales apagadas", () => {
  assert.equal(assertRealShadowRunEnvironment(prodEnv).projectRef, "bnzrnizrmonjxlktbhlp");
  for (const override of [
    { SHADOW_AI_MANUAL_REAL_ENABLED: "false" }, { SHADOW_AI_ENABLED: "true" }, { SHADOW_AI_PRODUCTION_ENABLED: "true" },
    { SHADOW_AI_ALLOW_REAL_MESSAGES: "true" }, { SHADOW_OUTBOUND_ENABLED: "true" },
    { SHADOW_AI_ALLOW_OPERATIONAL_EVENTS: "true" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://hjfwjnejbcpmknvfpdcq.supabase.co" },
  ]) assert.throws(() => assertRealShadowRunEnvironment({ ...prodEnv, ...override }));
});

test("identidad real incluye prompt específico y no usa campaign QA", () => {
  assert.notEqual(shadowAiIdempotencyKey(message.id, "claude", null, REAL_SHADOW_AI_PROMPT_VERSION), shadowAiIdempotencyKey(message.id, "claude"));
  assert.match(REAL_SHADOW_AI_PROMPT_VERSION, /real-shadow-v1$/);
  assert.doesNotMatch(REAL_SHADOW_AI_SYSTEM_PROMPT, /exclusivamente mensajes QA sintéticos/);
  assert.match(REAL_SHADOW_AI_SYSTEM_PROMPT, /nunca ejecutas acciones/);
});

test("endpoints aceptan sólo IDs, autentican y no contienen Respond/outbound/write", () => {
  const run = read("pages/api/operaciones/shadow-ai-real-run.js");
  const continuation = read("pages/api/operaciones/shadow-ai-real-continue.js");
  const authorize = read("pages/api/operaciones/shadow-ai-real-authorize.js");
  const revoke = read("pages/api/operaciones/shadow-ai-real-revoke.js");
  const devValidate = read("pages/api/operaciones/shadow-ai-real-dev-validate.js");
  for (const source of [run, continuation, authorize, revoke, devValidate]) {
    assert.match(source, /authorizeShadowAdministrator/);
    assert.match(source, /Object\.keys\(req\.body/);
    assert.doesNotMatch(source, /fetch\([^)]*respond|sendMessage|insert.*maintenance|update.*maintenance/is);
  }
  assert.match(run, /messageId/); assert.match(run, /authorizationId/); assert.doesNotMatch(run, /req\.body\?\.(?:text|message|prompt)(?:\s|\)|\||;)/);
  assert.match(continuation, /runId/);
  assert.match(devValidate, /realShadowDevCloneEligibility/);
  assert.doesNotMatch(devValidate, /startShadowAiStateMachine|createAnthropicShadowResponse/);
  assert.ok(devValidate.indexOf("authorizeShadowAdministrator") < devValidate.indexOf("loadRealShadowMessage"));
  assert.match(devValidate, /return res\.status\(403\).*No autorizado/);
});

test("UI sólo ofrece analizar/continuar, nunca enviar/aplicar/responder/asignar", () => {
  const ui = read("pages/coordinador-ia-sombra.js");
  assert.match(ui, />Analizar en Shadow</);
  assert.match(ui, />Continuar análisis</);
  assert.match(ui, />Autorizar análisis</);
  assert.match(ui, />Revocar autorización</);
  assert.match(ui, /DEV TEST/);
  assert.doesNotMatch(ui, />\s*(?:Enviar|Aplicar|Responder|Asignar)\s*</);
});

test("tool surface continúa estrictamente read-only", () => {
  assert.ok(READ_ONLY_SHADOW_TOOLS.length > 0);
  assert.equal(READ_ONLY_SHADOW_TOOLS.some((name) => /create|insert|update|delete|send|write/i.test(name)), false);
});

test("autorización tiene TTL corto y estados explícitos", () => {
  assert.equal(REAL_MANUAL_AUTHORIZATION_TTL_SECONDS, 600);
  const base = { expires_at: new Date(Date.now() + 60_000).toISOString(), consumed_at: null, revoked_at: null };
  assert.equal(manualAuthorizationState(base), "active");
  assert.equal(manualAuthorizationState({ ...base, consumed_at: new Date().toISOString() }), "consumed");
  assert.equal(manualAuthorizationState({ ...base, revoked_at: new Date().toISOString() }), "revoked");
  assert.equal(manualAuthorizationState({ ...base, expires_at: new Date(Date.now() - 1).toISOString() }), "expired");
  assert.equal(assertManualAuthorizationEnvironment(devEnv).mode, "dev_test");
});

test("readiness productivo incluye migración, checks y rollback conservador", () => {
  const sql = read("supabase/production/tests/202608220001_fase_2a_shadow_ai_manual_authorizations_checks.sql");
  assert.match(sql, /relrowsecurity/); assert.match(sql, /has_table_privilege\('anon'/);
  assert.match(sql, /authenticated'.*'INSERT,UPDATE,DELETE'/s);
  assert.doesNotMatch(sql, /\b(?:create|alter|drop|insert|update|delete)\s+(?:table|policy|into|public\.)/i);
  const migration = read("supabase/migrations/202608220001_fase_2a_shadow_ai_manual_authorizations.sql");
  assert.match(migration, /expires_at <= authorized_at \+ interval '15 minutes'/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /manual_authorization_not_consumable/);
  assert.doesNotMatch(migration, /sanitized_text|raw_payload|phone|email/i);
  const runbook = read("docs/operaciones/fase-2a-p3-shadow-real-manual-runbook.md");
  assert.match(runbook, /SHADOW_AI_MANUAL_REAL_ENABLED=true/);
  assert.match(runbook, /10 minutos/);
});
