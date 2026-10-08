import { defineMessagingProvider, messagingProviderError } from "../provider.js";
import { createMessagingEvent } from "../events.js";
import { extractRespondWebhookEvent, isValidRespondWebhookSignature } from "./respondWebhookCodec.js";

function transientContent(body, eventType) {
  if (!["message.received", "message.sent"].includes(eventType)) return null;
  const message = body?.message;
  const text = message?.text ?? message?.message?.text ?? message?.body ?? message?.message?.body;
  return {
    text: typeof text === "string" ? text : null,
    // Media capture/download and lane-specific caption selection are unchanged.
    hasAttachments: Boolean(message?.attachment || message?.attachments?.length
      || message?.message?.attachment || message?.message?.attachments?.length),
  };
}

export function createRespondProvider({ sendTextTransport } = {}) {
  if (sendTextTransport !== undefined && typeof sendTextTransport !== "function") {
    throw messagingProviderError("messaging_sender_invalid");
  }
  function normalizeWebhook(body) {
    const event = extractRespondWebhookEvent(body);
    return createMessagingEvent({ provider: "respond", eventType: event.eventType,
      eventId: event.eventId, contactId: event.respondContactId,
      channelId: event.channelId, messageId: event.messageId,
      occurredAt: event.eventOccurredAt, supported: event.supported,
      metadata: event.payloadMeta, content: transientContent(body, event.eventType) });
  }
  return defineMessagingProvider({
    id: "respond",
    capabilities: { connected: true, normalizeInbound: true, normalizeHumanOutbound: true,
      normalizeStatus: false, sendText: Boolean(sendTextTransport), sendMedia: false },
    verifyWebhook: isValidRespondWebhookSignature,
    normalizeWebhook,
    normalizeInbound(body) {
      const event = normalizeWebhook(body);
      return event.kind === "message.inbound" ? [event] : [];
    },
    normalizeStatus() {
      // No new status subscription/reducer. message.sent is an observation,
      // not proof of delivery/read and not a new customer inbound.
      return [];
    },
    normalizeHumanOutbound(body) {
      const event = normalizeWebhook(body);
      if (event.kind !== "message.outbound_observed") return [];
      const source = event.providerMetadata.sender_source;
      return [{ ...event, author: {
        // Matches #168's explicit signal; NOT assignee or absence of a journal.
        // The authenticated receiver/guards remain the authority, not this helper.
        kind: source === "user" ? "human" : "unknown",
        evidence: source === "user"
          ? "sender_source_user" : "human_authorship_unproven",
      } }];
    },
    async sendText(intent) {
      if (!sendTextTransport) throw messagingProviderError("messaging_sender_not_bound");
      // No trimming, auth/env lookup, retries, result conversion or fallback.
      // Destination policy and durable reservation are the existing caller's job.
      return sendTextTransport({ contactId: intent.recipient.providerContactId,
        channelId: intent.recipient.providerChannelId, text: intent.text });
    },
    async sendMedia() { throw messagingProviderError("messaging_media_unsupported"); },
  });
}
