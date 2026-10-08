import { defineMessagingProvider, messagingProviderError } from "../provider.js";

// Structural placeholder ONLY. No credentials, fetch, SDK, webhook endpoint,
// subscription, payload interpretation, environment switch or activation escape.
const disconnected = () => { throw messagingProviderError("messaging_meta_disconnected"); };

export const metaProvider = defineMessagingProvider({
  id: "meta",
  capabilities: { connected: false, normalizeInbound: false, normalizeHumanOutbound: false,
    normalizeStatus: false, sendText: false, sendMedia: false },
  verifyWebhook: () => false,
  normalizeWebhook: disconnected,
  normalizeInbound: disconnected,
  normalizeStatus: disconnected,
  normalizeHumanOutbound: disconnected,
  async sendText() { return disconnected(); },
  async sendMedia() { return disconnected(); },
});
