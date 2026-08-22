import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { REAL_SHADOW_ADMIN_CHANNEL_ID, realShadowEnvelope, realShadowMessageEligibility } from "../lib/shadow/ai/realMessage.js";
import { REAL_SHADOW_AI_PROMPT_VERSION, REAL_SHADOW_AI_SYSTEM_PROMPT } from "../lib/shadow/ai/realPrompt.js";
import { assertRealShadowRunEnvironment } from "../lib/shadow/ai/realRun.js";
import { shadowAiIdempotencyKey } from "../lib/shadow/ai/runner.js";
import { READ_ONLY_SHADOW_TOOLS } from "../lib/shadow/context.js";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const prodEnv = {
  VERCEL_ENV: "production", SUPABASE_ENVIRONMENT: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://bnzrnizrmonjxlktbhlp.supabase.co",
  SHADOW_AI_ENABLED: "true", SHADOW_AI_PRODUCTION_ENABLED: "true",
  SHADOW_AI_ALLOW_REAL_MESSAGES: "true", SHADOW_AI_ALLOW_OPERATIONAL_EVENTS: "false",
  SHADOW_OUTBOUND_ENABLED: "false", SHADOW_RESPOND_ADMIN_CHANNEL_ID: REAL_SHADOW_ADMIN_CHANNEL_ID,
};
const message = { id: "00000000-0000-4000-8000-000000000001", direction: "inbound", occurred_at: "2026-08-21T12:00:00Z", sanitized_text: "Sigue pendiente el mantenimiento", attachment_metadata: [], provider_metadata: {}, external_message_id: "respond-message-opaque" };
const conversation = { provider: "respond_admin", channel: REAL_SHADOW_ADMIN_CHANNEL_ID };

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

test("guard productivo requiere opt-ins exactos, Production correcto y outbound apagado", () => {
  assert.equal(assertRealShadowRunEnvironment(prodEnv).projectRef, "bnzrnizrmonjxlktbhlp");
  for (const override of [
    { SHADOW_AI_ENABLED: "false" }, { SHADOW_AI_PRODUCTION_ENABLED: "false" },
    { SHADOW_AI_ALLOW_REAL_MESSAGES: "false" }, { SHADOW_OUTBOUND_ENABLED: "true" },
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
  for (const source of [run, continuation]) {
    assert.match(source, /authorizeShadowAdministrator/);
    assert.match(source, /Object\.keys\(req\.body/);
    assert.doesNotMatch(source, /fetch\([^)]*respond|sendMessage|insert.*maintenance|update.*maintenance/is);
  }
  assert.match(run, /messageId/); assert.doesNotMatch(run, /req\.body\?\.(?:text|message|prompt)(?:\s|\)|\||;)/);
  assert.match(continuation, /runId/);
});

test("UI sólo ofrece analizar/continuar, nunca enviar/aplicar/responder/asignar", () => {
  const ui = read("pages/coordinador-ia-sombra.js");
  assert.match(ui, />Analizar en Shadow</);
  assert.match(ui, />Continuar análisis</);
  assert.doesNotMatch(ui, />\s*(?:Enviar|Aplicar|Responder|Asignar)\s*</);
});

test("tool surface continúa estrictamente read-only", () => {
  assert.ok(READ_ONLY_SHADOW_TOOLS.length > 0);
  assert.equal(READ_ONLY_SHADOW_TOOLS.some((name) => /create|insert|update|delete|send|write/i.test(name)), false);
});

test("readiness productivo es check read-only, conserva RLS y no introduce migración", () => {
  const sql = read("supabase/production/tests/202608210004_fase_2a_p3_real_shadow_manual_checks.sql");
  assert.match(sql, /relrowsecurity/); assert.match(sql, /has_table_privilege\('anon'/);
  assert.match(sql, /authenticated'.*'INSERT,UPDATE,DELETE'/s);
  assert.doesNotMatch(sql, /\b(?:create|alter|drop|insert|update|delete)\s+(?:table|policy|into|public\.)/i);
  const runbook = read("docs/operaciones/fase-2a-p3-shadow-real-manual-runbook.md");
  assert.match(runbook, /No hay migración de esquema/);
  assert.match(runbook, /no fue enviada ni aplicada/);
});
