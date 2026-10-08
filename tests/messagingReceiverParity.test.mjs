import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import * as before from "../lib/messaging/providers/respondWebhookCodec.js";
import * as afterAdapter from "../lib/ejecutivo/respondWebhook.js";
import { commercialQueueEligible, enqueueCommercialEvent } from "../lib/social/commercialQueue.js";
import { importWithStubs, response } from "./helpers/socialFixtures.mjs";

const previousFetch = globalThis.fetch;
globalThis.fetch = () => assert.fail("network/models/senders forbidden in receiver parity");
after(() => { globalThis.fetch = previousFetch; });
const bodyFor = (channelId = "544519", eventType = "message.received") => ({
  event_id: "synthetic-event", event_type: eventType, contact: { id: "synthetic-contact" },
  message: { id: "synthetic-message", channelId, text: "Consulta sintética", timestamp: 1791471837 },
});
const request = (body, { signature = "valid", raw, method = "POST" } = {}) => ({
  method,
  headers: { "x-webhook-signature": signature === "valid"
    ? createHmac("sha256", "synthetic-key").update(JSON.stringify(body)).digest("base64") : signature },
  async *[Symbol.asyncIterator]() { yield Buffer.from(raw ?? JSON.stringify(body)); },
});

async function receiver(webhook, options = {}) {
  const calls = [];
  const db = {
    async rpc(name, args) {
      calls.push({ operation: "rpc", name, args });
      if (options.waitForCommit) await options.waitForCommit;
      return options.rpcFailure ? { error: { code: "08006" } } : {
        data: { durable: true, duplicate: Boolean(options.duplicate), state: options.duplicate ? "complete" : "pending" },
      };
    },
    from(table) {
      return {
        async insert(row) {
          calls.push({ operation: "insert", table, row });
          return { error: options.duplicate ? { code: "23505" }
            : options.persistenceFailure ? { code: "08006" } : null };
        },
        update(row) { return { async eq(key, value) {
          calls.push({ operation: "update", table, row, key, value }); return { error: null };
        } }; },
      };
    },
  };
  const capture = name => async (_db, body) => { calls.push({ operation: name, body }); };
  const mod = await importWithStubs(new URL("../pages/api/webhooks/respond.js", import.meta.url), {
    "../../../lib/ejecutivo/workCenter": { assertSupabaseEnvironment() {}, getAdminSupabase: () => db },
    "../../../lib/ejecutivo/respondSync": { assertRespondIncrementalWebhooksEnabled() {} },
    "../../../lib/ejecutivo/respondWebhook": { ...webhook, resolveRespondWebhookSigningKeys: () => ["synthetic-key"] },
    "../../../lib/social/commercialQueue.js": { commercialQueueEligible, enqueueCommercialEvent },
    "../../../lib/shadow/providers/respondAdmin": { captureRespondAdminShadowIsolated: capture("admin_capture") },
    "../../../lib/shadow/media/reference": { captureRespondMediaReferenceIsolated: capture("media_capture") },
    "../../../lib/agentsV2/respondAppointmentSync": { captureRespondAppointmentLifecycleIsolated: capture("appointment_capture") },
    "../../../lib/respond/channelRouter": { routeRespondMessageIsolated: async event => {
      calls.push({ operation: "router", event });
      return options.audit ? { reason: "synthetic", audit: { reason: "synthetic", at: "2026-10-08T15:03:57Z" } }
        : { reason: "disabled" };
    } },
  });
  return { calls, handler: mod.default };
}

const cases = [
  ["commercial durable enqueue", bodyFor("498219"), {}, {}, 200],
  ["commercial duplicate reuses complete", bodyFor("497382"), { duplicate: true }, {}, 200],
  ["Admin existing chain", bodyFor(), {}, {}, 200],
  ["Admin duplicate preserves isolated captures", bodyFor(), { duplicate: true }, {}, 200],
  ["unchanged media payload", { ...bodyFor(), message: { ...bodyFor().message,
    attachment: { url: "https://invalid.example/synthetic", mimeType: "application/pdf" } } }, {}, {}, 200],
  ["human outgoing explicit source", { ...bodyFor("544519", "message.sent"),
    message: { ...bodyFor().message, sender: { source: "user" } } }, {}, {}, 200],
  ["unknown outgoing is not manufactured human", bodyFor("544519", "message.sent"), {}, {}, 200],
  ["episode closure", bodyFor("544519", "conversation.closed"), {}, {}, 200],
  ["appointment lifecycle", bodyFor("544519", "contact.lifecycle.updated"), {}, {}, 200],
  ["routing audit unchanged", bodyFor(), { audit: true }, {}, 200],
  ["bad HMAC", bodyFor(), {}, { signature: "wrong" }, 401],
  ["missing HMAC", bodyFor(), {}, { signature: "" }, 401],
  ["invalid JSON", bodyFor(), {}, { raw: "{" }, 400],
  ["oversized body", bodyFor(), {}, { raw: "x".repeat(256 * 1024 + 1) }, 413],
  ["non POST", bodyFor(), {}, { method: "GET" }, 405],
  ["unsupported delivery remains skipped", bodyFor("544519", "message.delivered"), {}, {}, 200],
  ["missing contact remains invalid", { ...bodyFor(), contact: null }, {}, {}, 400],
  ["persistence failure no false 200", bodyFor(), { persistenceFailure: true }, {}, 503],
  ["commercial transaction failure no false 200", bodyFor("498219"), { rpcFailure: true }, {}, 503],
];
for (const [label, body, options, requestOptions, statusCode] of cases) {
  test(`real receiver before/after parity: ${label}`, async () => {
    const baseline = await receiver(before, options);
    const current = await receiver(afterAdapter, options);
    const baselineResponse = response(), currentResponse = response();
    await baseline.handler(request(body, requestOptions), baselineResponse);
    await current.handler(request(body, requestOptions), currentResponse);
    assert.equal(currentResponse.statusCode, statusCode);
    assert.equal(currentResponse.statusCode, baselineResponse.statusCode);
    assert.deepEqual(currentResponse.body, baselineResponse.body);
    assert.deepEqual(current.calls, baseline.calls, "all persistence arguments and capture order must be identical");
    if (statusCode !== 200 && statusCode !== 503) assert.deepEqual(current.calls, []);
  });
}

test("neutral boundary does not acknowledge before durable transaction settles", async () => {
  let commit;
  const waitForCommit = new Promise(resolve => { commit = resolve; });
  const current = await receiver(afterAdapter, { waitForCommit });
  const res = response();
  const running = current.handler(request(bodyFor("498219")), res);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(res.statusCode, undefined);
  assert.equal(current.calls.length, 1);
  assert.equal(current.calls[0].name, "enqueue_respond_commercial_v1");
  commit();
  await running;
  assert.equal(res.statusCode, 200);
  assert.deepEqual(current.calls.map(c => c.operation), ["rpc"]);
});
