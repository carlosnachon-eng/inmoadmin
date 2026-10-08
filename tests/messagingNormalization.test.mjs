import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as baseline from "../lib/messaging/providers/respondWebhookCodec.js";
import * as facade from "../lib/ejecutivo/respondWebhook.js";
import { createRespondProvider } from "../lib/messaging/providers/respond.js";
import { toRespondWebhookEvent } from "../lib/messaging/compat/respondWebhook.js";

const priorFetch = globalThis.fetch;
globalThis.fetch = () => assert.fail("network forbidden in normalization tests");
after(() => { globalThis.fetch = priorFetch; });
const provider = createRespondProvider();
const fixture = (eventType = "message.received", channelId = "544519") => ({
  event_type: eventType, event_id: "synthetic-delivery", contact: { id: "synthetic-contact" },
  message: { messageId: "synthetic-message", channelId, timestamp: 1791471837,
    message: { type: "text", text: "Texto sintético, sin contacto real." } },
});

test("codec is byte-identical to audited main 3474954; HMAC and body reader are the same exports", async () => {
  const source = await readFile(new URL("../lib/messaging/providers/respondWebhookCodec.js", import.meta.url));
  assert.equal(createHash("sha256").update(source).digest("hex"),
    "fd6131bc0039770e945d409472ceb63d291ea2a22d257ec82e3eb9dfe833b1d6");
  for (const name of ["isValidRespondWebhookSignature", "readRespondWebhookBody",
    "resolveRespondWebhookSigningKeys", "RESPOND_SUPPORTED_WEBHOOK_EVENTS"])
    assert.equal(facade[name], baseline[name]);
});

for (const channelId of ["497382", "497385", "498219", "515318", "544519"]) {
  for (const eventType of baseline.RESPOND_SUPPORTED_WEBHOOK_EVENTS) {
    test(`exact projection parity: ${channelId} / ${eventType}`, () => {
      const body = fixture(eventType, channelId);
      const before = structuredClone(body);
      const expected = baseline.extractRespondWebhookEvent(body);
      const event = provider.normalizeWebhook(body);
      assert.deepEqual(toRespondWebhookEvent(event), expected);
      assert.deepEqual(facade.extractRespondWebhookEvent(body), expected);
      assert.equal(JSON.stringify(facade.extractRespondWebhookEvent(body)), JSON.stringify(expected));
      assert.deepEqual(body, before);
      assert.equal(event.provider, "respond");
      for (const key of ["partyId", "endpointId", "episodeId", "nativeMessageId"]) assert.equal(event[key], null);
      assert.equal(provider.normalizeInbound(body).length, eventType === "message.received" ? 1 : 0);
      assert.equal(provider.normalizeHumanOutbound(body).length, eventType === "message.sent" ? 1 : 0);
      assert.deepEqual(provider.normalizeStatus(body), []);
    });
  }
}

const edgeCases = [undefined, null, {}, [], "invalid-shape", { event_type: "message.delivered" },
  { event: "  New-Incoming Message  ", eventId: " synthetic-id ", contactId: 0,
    channel: { id: 0 }, message: { id: 0 }, timestamp: "not-a-date" },
  { event: "new_outgoing_message", eventId: "alias", message: { contactId: 42, id: 123, timestamp: 1791471837000000 } },
  { event_type: "conversation.closed", conversation: { contactId: "conv", channelId: 544519, closedTime: "2026-10-08T15:03:57Z" } },
  { event_type: "contact.updated", contact: { id: "first", assignee: { id: "synthetic-assignee" }, lifecycle: { id: "lifecycle" } },
    message: { contactId: "second", id: "m", timestamp: "1791471837000", traffic: "outgoing", sender: { source: "user" } },
    sourceChannelId: "https://invalid.example/secret", team: { id: "team" }, inbox: { id: "inbox" },
    workflow: { id: "workflow" }, routing: { reason: "handoff", routedAt: "2026-10-08T15:03:57Z" } },
  { ...fixture(), provider: "meta", wa_id: "synthetic-wa", wamid: "synthetic-native", phone_number_id: "synthetic-phone" },
  { ...fixture(), message: { messageId: "a", id: "b", channelId: " 544519 ", timestamp: -1,
    sender: { source: { unexpected: true } }, attachment: { url: "https://invalid.example/private" } } },
];
edgeCases.forEach((body, index) => test(`edge shape/alias/metadata parity ${index + 1}`, () => {
  assert.deepEqual(facade.extractRespondWebhookEvent(body), baseline.extractRespondWebhookEvent(body));
}));

test("common envelope carries transient text but never fabricates identity or delivery", () => {
  const body = fixture();
  const [event] = provider.normalizeInbound(body);
  assert.equal(event.content.text, body.message.message.text);
  assert.equal(event.kind, "message.inbound");
  assert.equal(event.occurredAt, "2026-10-08T15:03:57.000Z");
  assert.equal(event.content.hasAttachments, false);
  const withMedia = provider.normalizeInbound({ ...body, message: { ...body.message,
    attachment: { url: "https://invalid.example/opaque-token" } } })[0];
  assert.equal(withMedia.content.hasAttachments, true);
  assert.doesNotMatch(JSON.stringify(withMedia), /opaque-token/);
  assert.throws(() => toRespondWebhookEvent({ ...event, provider: "meta" }), /projection_invalid/);
});

for (const source of [undefined, "", "unknown", "workflow", "ai_agent", "agent", "human", "user", "USER", " user "]) {
  test(`human attribution requires explicit #168 signal (${String(source)})`, () => {
    const body = fixture("message.sent");
    body.contact.assignee = { id: "synthetic-assignee" };
    body.message.sender = { source };
    const [event] = provider.normalizeHumanOutbound(body);
    assert.equal(event.author.kind, source === "user" ? "human" : "unknown");
    assert.deepEqual(facade.extractRespondWebhookEvent(body), baseline.extractRespondWebhookEvent(body));
    assert.deepEqual(provider.normalizeInbound(body), []);
  });
}

test("repeat delivery stays pure and does not introduce in-memory dedupe/drop semantics", () => {
  const body = fixture();
  assert.deepEqual(provider.normalizeInbound(body), provider.normalizeInbound(body));
  const second = { ...body, event_id: "different-delivery" };
  assert.notEqual(provider.normalizeInbound(body)[0].providerEventId, provider.normalizeInbound(second)[0].providerEventId);
  assert.equal(provider.normalizeInbound(body)[0].providerMessageId, provider.normalizeInbound(second)[0].providerMessageId);
});
