import test from "node:test";
import assert from "node:assert/strict";

import {
  decideRespondMessageRoute,
  resolveRespondChannelRouterConfig,
  routeRespondMessageIsolated,
} from "../lib/respond/channelRouter.js";

const ADMIN = "544519";
const COMMERCIAL = ["497382", "497385", "498219", "515318"];
const ADMIN_URL = "https://webhook.respond.io/admin-fixture";
const COMMERCIAL_URL = "https://webhook.respond.io/commercial-fixture";

function config(overrides = {}) {
  return resolveRespondChannelRouterConfig({
    routerEnabled: "true",
    adminChannelId: ADMIN,
    commercialChannelIds: JSON.stringify(COMMERCIAL),
    adminWorkflowUrl: ADMIN_URL,
    commercialWorkflowUrl: COMMERCIAL_URL,
    ...overrides,
  });
}

function event(channelId, overrides = {}) {
  return {
    eventType: "message.received",
    eventId: `event-${channelId || "missing"}`,
    messageId: `message-${channelId || "missing"}`,
    respondContactId: "441329817",
    channelId,
    ...overrides,
  };
}

test("A: Administración se dirige exclusivamente al workflow humano", () => {
  const decision = decideRespondMessageRoute(event(ADMIN), config());
  assert.equal(decision.route, true);
  assert.equal(decision.decision, "admin_human");
  assert.equal(decision.target, "administracion");
  assert.equal(decision.workflowUrl, ADMIN_URL);
});

for (const [label, channelId] of [
  ["B Ventas", "498219"],
  ["C Instagram", "497382"],
  ["D TikTok", "497385"],
  ["E Messenger", "515318"],
]) {
  test(`${label}: canal comercial se dirige a Ivonne`, () => {
    const decision = decideRespondMessageRoute(event(channelId), config());
    assert.equal(decision.route, true);
    assert.equal(decision.decision, "commercial_ivonne");
    assert.equal(decision.target, "ivonne_recepcion_v2");
    assert.equal(decision.workflowUrl, COMMERCIAL_URL);
  });
}

test("F: canal desconocido aplica fail-safe sin IA", () => {
  const decision = decideRespondMessageRoute(event("otro-canal"), config());
  assert.equal(decision.route, false);
  assert.equal(decision.reason, "unknown_channel_fail_safe");
  assert.equal(decision.target, "none");
});

test("G: channelId faltante nunca usa IA", () => {
  const decision = decideRespondMessageRoute(event(null), config());
  assert.deepEqual(
    { route: decision.route, reason: decision.reason },
    { route: false, reason: "missing_channel_id" },
  );
});

test("H: contacto multicanal se decide por cada mensaje y no por assignee previo", () => {
  const contact = { respondContactId: "441329817", assignee: "ivonne-previa" };
  const sequence = ["498219", ADMIN, "498219"].map((channelId, index) => (
    decideRespondMessageRoute(event(channelId, { ...contact, eventId: `alternate-${index}` }), config()).decision
  ));
  assert.deepEqual(sequence, ["commercial_ivonne", "admin_human", "commercial_ivonne"]);
});

test("I: retry duplicado queda contenido por el insert único antes del router", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../pages/api/webhooks/respond.js", import.meta.url),
    "utf8",
  );
  const duplicateIndex = source.indexOf('if (error?.code === "23505")');
  const routerIndex = source.indexOf("routeRespondMessageIsolated(event)");
  assert.ok(duplicateIndex >= 0 && routerIndex > duplicateIndex);
  assert.match(source.slice(duplicateIndex, routerIndex), /return res\.status\(200\)\.json\(\{ ok: true, duplicate: true \}\)/);
});

test("J: fallo del workflow queda aislado y conserva auditoría sin PII", async () => {
  const result = await routeRespondMessageIsolated(event(ADMIN), {
    config: config(),
    fetchImpl: async () => ({ ok: false, status: 503 }),
    now: "2026-08-19T20:00:00.000Z",
  });
  assert.equal(result.status, "isolated_error");
  assert.equal(result.audit.result, "isolated_error");
  assert.deepEqual(Object.keys(result.audit).sort(), [
    "channel_id", "message_id", "result", "routed_at", "routing_decision", "target",
  ]);
});

test("K: router OFF no invoca ningún endpoint", async () => {
  let calls = 0;
  const result = await routeRespondMessageIsolated(event("498219"), {
    config: resolveRespondChannelRouterConfig({ routerEnabled: "false" }),
    fetchImpl: async () => { calls += 1; return { ok: true, status: 200 }; },
  });
  assert.equal(result.reason, "disabled");
  assert.equal(calls, 0);
});

test("L: Shadow permanece como fork independiente y posterior a persistencia", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../pages/api/webhooks/respond.js", import.meta.url),
    "utf8",
  );
  const insertIndex = source.indexOf('.from("gv_respond_webhook_events").insert');
  const routerIndex = source.indexOf("routeRespondMessageIsolated(event)");
  const shadowIndex = source.lastIndexOf("captureRespondAdminShadowIsolated(admin, body)");
  assert.ok(insertIndex >= 0 && routerIndex > insertIndex && shadowIndex > routerIndex);
});

test("configuración falla cerrada ante URLs, JSON o allowlists inseguros", () => {
  assert.equal(config({ adminWorkflowUrl: "https://example.com/hook" }).reason, "invalid_workflow_urls");
  assert.equal(config({ commercialChannelIds: "498219,515318" }).reason, "invalid_commercial_channel_ids");
  assert.equal(config({ commercialChannelIds: JSON.stringify([ADMIN]) }).reason, "channel_allowlists_overlap");
  assert.equal(config({ commercialWorkflowUrl: ADMIN_URL }).reason, "invalid_workflow_urls");
});

test("adapter envía sólo identificadores y decisión sanitizada", async () => {
  let request;
  const result = await routeRespondMessageIsolated(event("497382"), {
    config: config(),
    fetchImpl: async (url, options) => {
      request = { url, ...options, body: JSON.parse(options.body) };
      return { ok: true, status: 200 };
    },
  });
  assert.equal(result.status, "routed");
  assert.equal(request.url, COMMERCIAL_URL);
  assert.deepEqual(Object.keys(request.body).sort(), [
    "channelId", "contactId", "eventId", "messageId", "routingDecision",
  ]);
  assert.equal(request.body.contactId, "441329817");
  assert.equal(JSON.stringify(request.body).includes("text"), false);
});
