import { messagingProviderError } from "../provider.js";

// Exact projection for existing callers. No new fields cross into #165/#168/#170,
// and unknown metadata is not invented or reinterpreted by this bridge.
export function toRespondWebhookEvent(event) {
  if (event?.schemaVersion !== 1 || event?.provider !== "respond") {
    throw messagingProviderError("messaging_respond_projection_invalid");
  }
  return {
    eventId: event.providerEventId, eventType: event.providerEventType,
    supported: event.supported, respondContactId: event.providerContactId,
    eventOccurredAt: event.occurredAt, messageId: event.providerMessageId,
    channelId: event.providerChannelId, payloadMeta: { ...event.providerMetadata },
  };
}
