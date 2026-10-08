import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMessagingRegistry, messagingRegistry } from "../lib/messaging/registry.js";
import { createRespondProvider } from "../lib/messaging/providers/respond.js";
import { metaProvider } from "../lib/messaging/providers/meta.js";
import { defineMessagingProvider } from "../lib/messaging/provider.js";

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; assert.fail("real HTTP forbidden"); };
after(() => { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0); });

test("registry selects only Respond; Meta/unknown have no fallback or environment activation", async () => {
  assert.equal(messagingRegistry.select().id, "respond");
  assert.equal(messagingRegistry.select("respond"), messagingRegistry.select());
  for (const id of [null, "", "META", "__proto__", { provider: "respond" }])
    assert.throws(() => messagingRegistry.select(id), /messaging_provider_unknown/);
  assert.throws(() => messagingRegistry.select("meta"), /messaging_meta_disconnected/);
  const before = process.env.MESSAGING_PROVIDER;
  process.env.MESSAGING_PROVIDER = "meta";
  try { assert.equal(createMessagingRegistry().select().id, "respond"); }
  finally { if (before === undefined) delete process.env.MESSAGING_PROVIDER; else process.env.MESSAGING_PROVIDER = before; }
  assert.equal(Object.isFrozen(messagingRegistry), true);
  assert.equal(Object.isFrozen(messagingRegistry.select()), true);
  assert.equal(Object.isFrozen(messagingRegistry.select().capabilities), true);
  await assert.rejects(messagingRegistry.select().sendText({}), /messaging_sender_not_bound/);
  await assert.rejects(messagingRegistry.select().sendMedia({}), /messaging_media_unsupported/);
  assert.throws(() => createRespondProvider({ sendTextTransport: true }), /messaging_sender_invalid/);
  assert.throws(() => defineMessagingProvider({ id: "respond" }), /messaging_provider_contract_invalid/);
});

test("Meta placeholder is inert even when called directly", async () => {
  assert.equal(metaProvider.verifyWebhook({}, "synthetic", ["synthetic"]), false);
  for (const method of ["normalizeWebhook", "normalizeInbound", "normalizeStatus", "normalizeHumanOutbound"])
    assert.throws(() => metaProvider[method]({}), /messaging_meta_disconnected/);
  for (const method of ["sendText", "sendMedia"])
    await assert.rejects(metaProvider[method]({}), /messaging_meta_disconnected/);
  assert.ok(Object.values(metaProvider.capabilities).every(value => value === false));
});

test("bound sender receives exact prepared text/destination once; result and errors stay opaque", async () => {
  const calls = [], result = { accepted: true, delivery: "not_accredited" };
  const registry = createMessagingRegistry({ respondSendTextTransport: async args => { calls.push(args); return result; } });
  const intent = { recipient: { providerContactId: "synthetic-c", providerChannelId: "544519" }, text: "  texto\n sin reformatear  " };
  assert.equal(await registry.select().sendText(intent), result);
  assert.deepEqual(calls, [{ contactId: "synthetic-c", channelId: "544519", text: intent.text }]);
  const uncertain = new Error("synthetic_delivery_unknown");
  let attempts = 0;
  const provider = createRespondProvider({ sendTextTransport: () => { attempts++; throw uncertain; } });
  await assert.rejects(provider.sendText(intent), error => error === uncertain);
  assert.equal(attempts, 1);
});

// Extract ONLY the existing private HTTP helper, unchanged, with synthetic env
// and intercepted fetch. No processors, models, databases or real credentials.
async function legacySender(file, fetchImpl) {
  const source = await readFile(new URL(`../lib/agentsV2/${file}`, import.meta.url), "utf8");
  const clean = source.match(/^const clean=.*$/m)?.[0];
  const sender = source.match(/async function sendRespond\([\s\S]*?\n\}/)?.[0];
  assert.ok(clean && sender, "existing sender helper must be located, never silently stubbed");
  return new Function("fetch", "syntheticEnv", `${clean}\n${sender}\nreturn args => sendRespond({...args, env: syntheticEnv});`)
    (fetchImpl, { RESPOND_IO_TOKEN: "synthetic-not-a-real-token" });
}

for (const file of ["salesAutoOutbound.js", "processOwnerInbound.js", "processLegalInbound.js"]) {
  for (const scenario of ["accepted", "rejected", "rate_limit", "server_error", "missing_id", "invalid_json", "timeout"]) {
    test(`delegation parity ${file}: ${scenario} (one attempt, intercepted)`, async () => {
      const calls = [];
      const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        if (scenario === "timeout") throw new Error("synthetic_timeout");
        const status = { rejected: 400, rate_limit: 429, server_error: 500 }[scenario] || 200;
        return { ok: status === 200, status, json: async () => {
          if (scenario === "invalid_json") throw new Error("synthetic_json");
          return scenario === "missing_id" ? {} : { messageId: "synthetic-provider-message" };
        } };
      };
      const sender = await legacySender(file, fetchImpl);
      const args = { contactId: "synthetic/contact", channelId: "544519", text: "  texto\n sintético  " };
      const settle = async call => { try { return { result: await call() }; } catch (error) { return { error: error.message }; } };
      const old = await settle(() => sender(args));
      const adapter = createRespondProvider({ sendTextTransport: sender });
      const next = await settle(() => adapter.sendText({ recipient: {
        providerContactId: args.contactId, providerChannelId: args.channelId }, text: args.text }));
      assert.deepEqual(next, old);
      assert.equal(calls.length, 2, "one baseline request and one adapted request; no retry");
      assert.deepEqual(calls[1], calls[0]);
      assert.equal(calls[1].options.method, "POST");
      assert.equal(calls[1].url, "https://api.respond.io/v2/contact/id:synthetic%2Fcontact/message");
      assert.deepEqual(JSON.parse(calls[1].options.body), { channelId: 544519, message: { type: "text", text: "texto sintético" } });
    });
  }
}
