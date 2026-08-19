import { ingestShadowEnvelope, sha256, validateShadowEnvelope } from "../coordinator.js";

const INBOUND_EVENTS = new Set(["message.received", "new_incoming_message"]);
const OUTBOUND_EVENTS = new Set(["message.sent", "new_outgoing_message"]);

const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);

export function normalizeRespondMessageEvent(value) {
  return clean(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
}

export function respondEventType(payload) {
  return normalizeRespondMessageEvent(payload?.event_type || payload?.event || payload?.type);
}

export function respondChannelId(payload) {
  const message = payload?.message || {};
  const conversation = payload?.conversation || {};
  const channel = payload?.channel || {};
  return clean(
    message.channelId
      ?? conversation.channelId
      ?? payload?.channelId
      ?? channel.id,
    80,
  ) || null;
}

export function shouldCaptureRespondAdmin(payload, {
  enabled = process.env.SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED,
  adminChannelId = process.env.SHADOW_RESPOND_ADMIN_CHANNEL_ID,
} = {}) {
  if (String(enabled).trim().toLowerCase() !== "true") return { capture: false, reason: "disabled" };
  const expected = clean(adminChannelId, 80);
  if (!expected) return { capture: false, reason: "missing_admin_channel_id" };
  const channelId = respondChannelId(payload);
  if (!channelId) return { capture: false, reason: "missing_channel_id" };
  if (channelId !== expected) return { capture: false, reason: "channel_not_allowlisted" };
  const eventType = respondEventType(payload);
  if (!INBOUND_EVENTS.has(eventType) && !OUTBOUND_EVENTS.has(eventType)) {
    return { capture: false, reason: "unsupported_message_event" };
  }
  return { capture: true, channelId, eventType };
}

function timestampIso(payload) {
  const value = payload?.message?.timestamp ?? payload?.timestamp ?? payload?.created_at;
  if (value === undefined || value === null || value === "") throw new Error("Evento Respond sin timestamp.");
  let parsed;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const numeric = Number(value);
    parsed = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  } else {
    parsed = new Date(value);
  }
  if (Number.isNaN(parsed.getTime())) throw new Error("Timestamp Respond inválido.");
  return parsed.toISOString();
}

function textFromMessage(message) {
  return message?.text ?? message?.message?.text ?? message?.body ?? message?.message?.body ?? "";
}

function attachmentMetadata(message) {
  const type = clean(message?.type || message?.message?.type, 40).toLowerCase();
  if (!type || type === "text") return [];
  return [{ type }];
}

export function transformRespondAdminPayload(payload) {
  const decision = shouldCaptureRespondAdmin(payload, { enabled: "true", adminChannelId: respondChannelId(payload) });
  if (!decision.capture) throw new Error(`Evento Respond/Admin no transformable: ${decision.reason}.`);
  const message = payload.message || {};
  const contact = payload.contact || {};
  const conversation = payload.conversation || {};
  const eventId = clean(payload.event_id || payload.eventId || payload.id);
  const messageId = clean(message.messageId || message.id) || null;
  const contactId = clean(contact.id ?? message.contactId ?? conversation.contactId ?? payload.contactId);
  const conversationId = clean(conversation.id ?? message.conversationId) || (contactId ? `contact:${contactId}` : "");
  if (!contactId || !conversationId) throw new Error("Evento Respond/Admin sin contacto o conversación.");
  const occurredAt = timestampIso(payload);
  const direction = INBOUND_EVENTS.has(decision.eventType) ? "inbound" : "outbound_human";
  const sanitizedText = textFromMessage(message);
  const payloadFingerprint = sha256(JSON.stringify({
    provider: "respond_admin",
    eventId: eventId || null,
    messageId: eventId ? null : messageId,
    conversationId,
    channelId: decision.channelId,
    direction,
    occurredAt,
    textHash: sha256(sanitizedText),
  }));

  return validateShadowEnvelope({
    provider: "respond_admin",
    externalEventId: eventId,
    externalMessageId: messageId,
    externalConversationId: conversationId,
    externalContactId: contactId,
    channel: decision.channelId,
    direction,
    occurredAt,
    sanitizedText,
    attachmentMetadata: attachmentMetadata(message),
    providerMetadata: {
      eventType: decision.eventType,
      messageType: message.type || message.message?.type,
      senderSource: message.sender?.source,
      echoGatePending: direction === "outbound_human",
    },
    payloadFingerprint,
  });
}

export async function captureRespondAdminShadowIsolated(admin, payload, { timeoutMs = 800 } = {}) {
  const decision = shouldCaptureRespondAdmin(payload);
  if (!decision.capture) return { status: "skipped", reason: decision.reason };
  if (process.env.VERCEL_ENV === "production" || process.env.SUPABASE_ENVIRONMENT === "production") {
    return { status: "blocked_production" };
  }
  try {
    return await Promise.race([
      ingestShadowEnvelope(admin, transformRespondAdminPayload(payload)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("respond_admin_shadow_timeout")), timeoutMs)),
    ]);
  } catch (error) {
    console.error("[respond-admin-shadow-isolated]", error?.message || "shadow_error");
    return { status: "isolated_error" };
  }
}
