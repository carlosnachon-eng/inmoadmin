import test from "node:test";
import assert from "node:assert/strict";

import {
  decideRespondMessageRoute,
  extractCanonicalEmpPropertyIds,
  resolveRespondTerritorialRoute,
  resolveRespondChannelRouterConfig,
  routeRespondMessageIsolated,
} from "../lib/respond/channelRouter.js";

test("extracts one canonical Emporio property id without accepting loose text", () => {
  assert.deepEqual(extractCanonicalEmpPropertyIds("Hola, me interesa EMP-MTPYQ9RR - casa"), ["EMP-MTPYQ9RR"]);
  assert.deepEqual(extractCanonicalEmpPropertyIds("Veracruz Boca del Rio"), []);
  assert.deepEqual(extractCanonicalEmpPropertyIds("EMP-MTPYQ9RR y EMP-MTORC2IH"), ["EMP-MTPYQ9RR", "EMP-MTORC2IH"]);
});

function fakeAdmin({ properties = [], plaza = null, team = null } = {}) {
  return {
    from(table) {
      const result = table === "propiedades" ? { data: properties, error: null }
        : table === "commercial_plazas" ? { data: plaza, error: null }
          : { data: team, error: null };
      const query = {
        select: () => query,
        eq: () => query,
        limit: async () => result,
        maybeSingle: async () => result,
      };
      return query;
    },
  };
}

test("routes only an exact, unique Veracruz property through the mapped teams", async () => {
  const route = await resolveRespondTerritorialRoute({
    messageText: "Hola, me interesa EMP-MTPYQ9RR",
    eventId: "evt-1", messageId: "msg-1", respondContactId: "contact-1", channelId: "497382",
  }, {
    admin: fakeAdmin({
      properties: [{ id: "property-1", public_id: "EMP-MTPYQ9RR", plaza_id: "plaza-veracruz" }],
      plaza: { id: "plaza-veracruz", code: "VERACRUZ" },
      team: { id: "team-veracruz", plaza_id: "plaza-veracruz" },
    }),
    targetSalesTeamId: "team-veracruz",
    targetRespondTeamId: "50622",
    territorialWorkflowUrl: "https://hooks.respond.io/territorial-test",
  });
  assert.equal(route.route, true);
  assert.equal(route.propertyPublicId, "EMP-MTPYQ9RR");
  assert.equal(route.respondTeamId, "50622");
});

test("does not route missing, unknown, ambiguous or Puebla property ids to Veracruz", async () => {
  const cases = [
    [{ messageText: "Busco casa" }, fakeAdmin(), "missing_property_id"],
    [{ messageText: "EMP-AAAAAAAA" }, fakeAdmin(), "unknown_property_id"],
    [{ messageText: "EMP-AAAAAAAA EMP-BBBBBBBB" }, fakeAdmin(), "ambiguous_property_id"],
    [{ messageText: "EMP-AAAAAAAA" }, fakeAdmin({ properties: [{ id: "p", public_id: "EMP-AAAAAAAA", plaza_id: "puebla" }], plaza: { id: "puebla", code: "PUEBLA" } }), "non_target_plaza"],
  ];
  for (const [event, admin, reason] of cases) {
    const result = await resolveRespondTerritorialRoute(event, { admin });
    assert.equal(result.route, false);
    assert.equal(result.reason, reason);
  }
});

const ADMIN = "544519";
const COMMERCIAL = ["497382", "497385", "498219", "515318"];
const ADMIN_URL = "https://hooks.respond.io/admin-fixture";
const COMMERCIAL_URL = "https://hooks.respond.io/commercial-fixture";

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
  const routerIndex = source.indexOf("routeRespondMessageIsolated(event, { admin })");
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
  const routerIndex = source.indexOf("routeRespondMessageIsolated(event, { admin })");
  const shadowIndex = source.lastIndexOf("captureRespondAdminShadowIsolated(admin, body)");
  assert.ok(insertIndex >= 0 && routerIndex > insertIndex && shadowIndex > routerIndex);
});

test("configuración falla cerrada ante URLs, JSON o allowlists inseguros", () => {
  assert.equal(config({ adminWorkflowUrl: "https://example.com/hook" }).reason, "invalid_workflow_urls");
  assert.equal(config({ commercialChannelIds: "498219,515318" }).reason, "invalid_commercial_channel_ids");
  assert.equal(config({ commercialChannelIds: JSON.stringify([ADMIN]) }).reason, "channel_allowlists_overlap");
  assert.equal(config({ commercialWorkflowUrl: ADMIN_URL }).reason, "invalid_workflow_urls");
});

test("acepta exclusivamente HTTPS en el host exacto hooks.respond.io", () => {
  const opaqueUrl = "https://hooks.respond.io/workflows/opaque-fixture";
  const resolved = config({ adminWorkflowUrl: opaqueUrl });
  assert.equal(resolved.valid, true);
  assert.equal(resolved.adminWorkflowUrl, opaqueUrl);
});

test("rechaza hosts parecidos, userinfo, loopback, esquemas inseguros y URL malformada", () => {
  for (const unsafeUrl of [
    "https://evil.respond.io.example.com/workflow",
    "https://respond.io.evil.com/workflow",
    "https://hooks.respond.io.evil.com/workflow",
    "https://sub.hooks.respond.io/workflow",
    "https://localhost/workflow",
    "https://127.0.0.1/workflow",
    "https://user@hooks.respond.io/workflow",
    "https://user:password@hooks.respond.io/workflow",
    "not a url",
    "http://hooks.respond.io/workflow",
    "ftp://hooks.respond.io/workflow",
    "javascript:alert(1)",
    "data:text/plain,workflow",
  ]) {
    assert.equal(
      config({ adminWorkflowUrl: unsafeUrl }).reason,
      "invalid_workflow_urls",
      unsafeUrl,
    );
  }
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
    "channelId", "contactId", "eventId", "messageId", "plazaCode",
    "propertyPublicId", "respondTeamId", "routingDecision", "salesTeamId",
  ]);
  assert.equal(request.body.contactId, "441329817");
  assert.equal(JSON.stringify(request.body).includes("text"), false);
});
