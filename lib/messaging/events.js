/**
 * Common transport envelope, not a persisted canonical identity/dedupe key.
 * providerEventId and providerMessageId MUST NOT be used across providers.
 * Unknown native IDs/party/episode stay null; no phone/time-based inference.
 * Content is transient and untrusted; existing lane sanitizers remain in place.
 * Never log this envelope (contact references/content may be personal data).
 *
 * @typedef {Object} MessagingEvent
 * @property {1} schemaVersion
 * @property {'respond'|'meta'} provider
 * @property {string} kind
 * @property {string} providerEventType
 * @property {string} providerEventId
 * @property {?string} providerContactId
 * @property {?string} providerChannelId
 * @property {?string} providerMessageId
 * @property {?string} occurredAt
 * @property {boolean} supported
 */
const KINDS = new Map([
  ["message.received", "message.inbound"],
  ["message.sent", "message.outbound_observed"],
  ["contact.created", "contact.created"],
  ["contact.updated", "contact.updated"],
  ["contact.assignee.updated", "contact.assignee_updated"],
  ["contact.lifecycle.updated", "contact.lifecycle_updated"],
  ["conversation.opened", "conversation.opened"],
  ["conversation.closed", "conversation.closed"],
]);

export function createMessagingEvent({ provider, eventType, eventId, contactId,
  channelId, messageId, occurredAt, supported, metadata, content = null }) {
  return {
    schemaVersion: 1, provider,
    kind: supported ? KINDS.get(eventType) || "unsupported" : "unsupported",
    providerEventType: eventType, providerEventId: eventId,
    providerContactId: contactId, providerChannelId: channelId,
    providerMessageId: messageId, occurredAt, supported,
    // Deferred until a verified identity bridge exists. Do not invent these.
    nativeMessageId: null, partyId: null, endpointId: null, episodeId: null,
    content, providerMetadata: { ...metadata },
  };
}
