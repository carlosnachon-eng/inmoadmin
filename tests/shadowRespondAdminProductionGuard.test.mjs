import assert from "node:assert/strict";
import test from "node:test";

import { RESPOND_ADMIN_FIXTURE_CHANNELS, RESPOND_ADMIN_FIXTURES } from "../lib/shadow/providers/respondAdmin.fixtures.js";
import { respondAdminCaptureDecision } from "../lib/shadow/providers/respondAdmin.js";

const DEV_URL = "https://hjfwjnejbcpmknvfpdcq.supabase.co";
const PRODUCTION_URL = "https://bnzrnizrmonjxlktbhlp.supabase.co";
const base = {
  enabled: "true",
  adminChannelId: RESPOND_ADMIN_FIXTURE_CHANNELS.admin,
  outboundEnabled: "false",
};
const production = {
  ...base,
  vercelEnvironment: "production",
  supabaseEnvironment: "production",
  supabaseUrl: PRODUCTION_URL,
  productionEnabled: "true",
};
const preview = {
  ...base,
  vercelEnvironment: "preview",
  supabaseEnvironment: "dev",
  supabaseUrl: DEV_URL,
  productionEnabled: "false",
};

test("A: Production con capture=false permanece deshabilitado", () => {
  assert.deepEqual(respondAdminCaptureDecision(RESPOND_ADMIN_FIXTURES.inboundAdmin, { ...production, enabled: "false" }), {
    capture: false,
    reason: "disabled",
  });
});

test("B: Production requiere la segunda autorización explícita", () => {
  assert.equal(respondAdminCaptureDecision(RESPOND_ADMIN_FIXTURES.inboundAdmin, { ...production, productionEnabled: "false" }).reason, "production_disabled");
});

test("C: Production correcto queda permitido sólo por la guarda", () => {
  const decision = respondAdminCaptureDecision(RESPOND_ADMIN_FIXTURES.inboundAdmin, production);
  assert.equal(decision.capture, true);
  assert.equal(decision.environment, "production");
  assert.equal(decision.projectRef, "bnzrnizrmonjxlktbhlp");
});

test("D: Production con Supabase DEV queda bloqueado", () => {
  assert.equal(respondAdminCaptureDecision(RESPOND_ADMIN_FIXTURES.inboundAdmin, { ...production, supabaseUrl: DEV_URL }).reason, "production_environment_mismatch");
});

test("E: Preview con Supabase Production queda bloqueado", () => {
  assert.equal(respondAdminCaptureDecision(RESPOND_ADMIN_FIXTURES.inboundAdmin, { ...preview, supabaseUrl: PRODUCTION_URL }).reason, "development_environment_mismatch");
});

test("F: Preview con DEV exacto queda permitido", () => {
  const decision = respondAdminCaptureDecision(RESPOND_ADMIN_FIXTURES.inboundAdmin, preview);
  assert.equal(decision.capture, true);
  assert.equal(decision.environment, "dev");
  assert.equal(decision.projectRef, "hjfwjnejbcpmknvfpdcq");
});

test("G: channelId faltante queda bloqueado", () => {
  assert.equal(respondAdminCaptureDecision(RESPOND_ADMIN_FIXTURES.inboundAdmin, { ...preview, adminChannelId: "" }).reason, "missing_admin_channel_id");
});

test("H: channelId distinto queda bloqueado", () => {
  assert.equal(respondAdminCaptureDecision(RESPOND_ADMIN_FIXTURES.inboundAdmin, { ...preview, adminChannelId: "otro-canal" }).reason, "channel_not_allowlisted");
});

test("I: outbound habilitado bloquea captura", () => {
  assert.equal(respondAdminCaptureDecision(RESPOND_ADMIN_FIXTURES.inboundAdmin, { ...preview, outboundEnabled: "true" }).reason, "outbound_enabled");
});

test("J: Ventas nunca entra a Respond Admin Shadow", () => {
  assert.equal(respondAdminCaptureDecision(RESPOND_ADMIN_FIXTURES.inboundSales, preview).reason, "channel_not_allowlisted");
});
