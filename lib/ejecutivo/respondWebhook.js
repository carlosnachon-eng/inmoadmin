import { messagingRegistry } from "../messaging/registry.js";
import { toRespondWebhookEvent } from "../messaging/compat/respondWebhook.js";

// Preserve existing imports and signature/body-reader behavior byte-for-byte.
export { RESPOND_SUPPORTED_WEBHOOK_EVENTS, MAX_RESPOND_WEBHOOK_SIGNING_KEYS,
  resolveRespondWebhookSigningKeys, readRespondWebhookBody,
  isValidRespondWebhookSignature } from "../messaging/providers/respondWebhookCodec.js";

export function extractRespondWebhookEvent(body) {
  // This endpoint is Respond-only regardless of payload fields or environment.
  return toRespondWebhookEvent(messagingRegistry.select("respond").normalizeWebhook(body));
}
