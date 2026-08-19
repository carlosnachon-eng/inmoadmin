import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { DIALOG360_FIXTURES, DIALOG360_FIXTURE_NOW } from "../lib/shadow/providers/360dialog.fixtures.js";
import { handle360DialogWebhook } from "../lib/shadow/providers/360dialogWebhook.js";

const response = () => ({
  code: 200, body: null, headers: {},
  setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});
const request = (body, secret = "fixture-secret") => ({ method: "POST", body, headers: { "x-shadow-webhook-secret": secret } });
const dev = () => ({ env: "preview", projectRef: "hjfwjnejbcpmknvfpdcq" });
const devProjectRef = "hjfwjnejbcpmknvfpdcq";
const enabled = { SHADOW_360DIALOG_CAPTURE_ENABLED: "true", SHADOW_OUTBOUND_ENABLED: "false", SHADOW_360DIALOG_WEBHOOK_SECRET: "fixture-secret" };

test("endpoint queda deshabilitado por default y bloqueado en Producción", async () => {
  let res = response();
  await handle360DialogWebhook(request(DIALOG360_FIXTURES.textInbound), res, { env: {}, environment: dev, devProjectRef: "hjfwjnejbcpmknvfpdcq" });
  assert.equal(res.code, 404);
  res = response();
  await handle360DialogWebhook(request(DIALOG360_FIXTURES.textInbound), res, { env: enabled, environment: () => ({ env: "production", projectRef: "bnzrnizrmonjxlktbhlp" }), devProjectRef: "hjfwjnejbcpmknvfpdcq" });
  assert.equal(res.code, 404);
});

test("exige secreto configurado como header y sólo POST", async () => {
  let res = response();
  await handle360DialogWebhook({ method: "GET", headers: {}, body: {} }, res, { env: enabled, environment: dev, devProjectRef });
  assert.equal(res.code, 405);
  res = response();
  await handle360DialogWebhook(request(DIALOG360_FIXTURES.textInbound, "incorrecto"), res, { env: enabled, environment: dev, devProjectRef });
  assert.equal(res.code, 401);
});

test("status no entra al Shadow y payload inválido/grande se rechaza", async () => {
  let calls = 0;
  const dependencies = { env: enabled, environment: dev, devProjectRef, now: DIALOG360_FIXTURE_NOW, processEnvelope: async () => { calls += 1; } };
  let res = response();
  await handle360DialogWebhook(request(DIALOG360_FIXTURES.status), res, dependencies);
  assert.equal(res.code, 200); assert.equal(calls, 0);
  res = response();
  await handle360DialogWebhook(request(DIALOG360_FIXTURES.malformed), res, dependencies);
  assert.equal(res.code, 400); assert.equal(calls, 0);
  res = response();
  await handle360DialogWebhook(request(DIALOG360_FIXTURES.oversized), res, dependencies);
  assert.equal(res.code, 413); assert.equal(calls, 0);
});

test("inbound y echo pasan una sola vez al pipeline inyectado", async () => {
  const seen = [];
  const dependencies = {
    env: enabled, environment: dev, devProjectRef, now: DIALOG360_FIXTURE_NOW, getAdmin: () => ({}),
    processEnvelope: async (_admin, envelope) => { seen.push(envelope); return { status: "accepted" }; },
  };
  for (const fixture of [DIALOG360_FIXTURES.textInbound, DIALOG360_FIXTURES.appEcho]) {
    const res = response(); await handle360DialogWebhook(request(fixture), res, dependencies); assert.equal(res.code, 200);
  }
  assert.deepEqual(seen.map((item) => item.direction), ["inbound", "outbound"]);
  assert.equal(seen[1].providerMetadata.humanEcho, "true");
});

test("fallo aislado devuelve retry sólo cuando todos los mensajes fallan", async () => {
  const res = response();
  await handle360DialogWebhook(request(DIALOG360_FIXTURES.textInbound), res, {
    env: enabled, environment: dev, devProjectRef, now: DIALOG360_FIXTURE_NOW, getAdmin: () => ({}), processEnvelope: async () => { throw new Error("isolated"); },
  });
  assert.equal(res.code, 503); assert.equal(res.body.failed, 1);
});

test("no existe cliente outbound, descarga de media, mutación ERP, secreto frontend o LLM", () => {
  const endpoint = fs.readFileSync(new URL("../pages/api/shadow/providers/360dialog.js", import.meta.url), "utf8");
  const adapter = fs.readFileSync(new URL("../lib/shadow/providers/360dialog.js", import.meta.url), "utf8");
  const webhook = fs.readFileSync(new URL("../lib/shadow/providers/360dialogWebhook.js", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
  const sql = fs.readFileSync(new URL("../supabase/dev/bootstrap/202608190001_fase_2a_p1_360dialog_provider.sql", import.meta.url), "utf8");
  assert.doesNotMatch(`${endpoint}\n${adapter}\n${webhook}`, /waba-v2\.360dialog\.io|\/messages\b|fetch\s*\(/);
  assert.doesNotMatch(`${endpoint}\n${adapter}\n${webhook}`, /payments|contracts|cash_movements|openai|anthropic|responses\.create/i);
  assert.doesNotMatch(ui, /SHADOW_360DIALOG_WEBHOOK_SECRET|D360-API-KEY/);
  assert.match(ui, /WhatsApp Administración/);
  assert.match(ui, /Respuesta humana desde WhatsApp Business App/);
  assert.match(sql, /grant execute[^;]+service_role/is);
  assert.match(sql, /revoke all[^;]+anon, authenticated/is);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
});
