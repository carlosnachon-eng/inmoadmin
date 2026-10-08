import { createHmac, timingSafeEqual } from "node:crypto";
import { defineMessagingProvider, messagingProviderError } from "../provider.js";
import { normalizeMetaObservations } from "../metaObserver/normalize.js";

export function verifyMetaSignature(raw, signature, appSecret) {
  if (!Buffer.isBuffer(raw) || typeof appSecret !== "string" || !appSecret
    || typeof signature !== "string" || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", appSecret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

// Separate, receive-only factory. The commercial registry/Meta placeholder from
// #172 remain DISCONNECTED. No configuration can enable a Meta sender here.
export function createMetaObserverProvider(scope) {
  const pinned = Object.freeze({ wabaId: scope?.wabaId, phoneNumberId: scope?.phoneNumberId });
  const normalize = body => normalizeMetaObservations(body, pinned);
  const noSend = async () => { throw messagingProviderError("meta_observer_send_forbidden"); };
  return defineMessagingProvider({ id: "meta",
    capabilities: { connected: false, observerOnly: true, normalizeInbound: true,
      normalizeStatus: true, normalizeHumanOutbound: true, sendText: false, sendMedia: false },
    verifyWebhook: verifyMetaSignature,
    normalizeWebhook: normalize,
    normalizeInbound: body => normalize(body).events.filter(e => e.kind === "message.inbound"),
    normalizeStatus: body => normalize(body).events.filter(e => e.kind === "message.status"),
    // Includes app-origin observations, NOT certification of a named human.
    normalizeHumanOutbound: body => normalize(body).events.filter(e => e.providerMetadata.category === "app_echo"),
    sendText: noSend, sendMedia: noSend,
  });
}
