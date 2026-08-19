import crypto from "node:crypto";
import { sha256, validateShadowEnvelope } from "../coordinator.js";

export const MAX_360DIALOG_WEBHOOK_BYTES = 256 * 1024;
export const DEFAULT_360DIALOG_MAX_EVENT_AGE_SECONDS = 48 * 60 * 60;
const MAX_FUTURE_SKEW_SECONDS = 5 * 60;
const MEDIA_TYPES = new Set(["image", "document", "audio", "video", "sticker"]);

const toIso = (value) => {
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Timestamp 360dialog inválido.");
  return date.toISOString();
};

const generalMime = (value) => {
  const [type, subtype] = String(value || "").toLowerCase().split("/");
  if (!type || !subtype || !["image", "application", "audio", "video"].includes(type)) return "application/octet-stream";
  return `${type}/${subtype.slice(0, 80)}`;
};

const messageText = (message) => {
  if (message?.type === "text") return message.text?.body || "";
  if (message?.type === "button") return message.button?.text || "";
  if (message?.type === "interactive") return message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
  if (message?.type === "location") return "[UBICACION]";
  if (MEDIA_TYPES.has(message?.type)) return message[message.type]?.caption || "";
  return "";
};

const attachmentMetadata = (message) => {
  if (!MEDIA_TYPES.has(message?.type)) return [];
  const media = message[message.type] || {};
  return [{
    type: message.type,
    mimeType: generalMime(media.mime_type),
    exists: true,
    mediaIdHash: media.id ? sha256(`360dialog-media:${media.id}`) : undefined,
    size: Number.isFinite(Number(media.file_size)) ? Number(media.file_size) : undefined,
  }];
};

const stableConversationId = (phoneNumberId, contactId) => sha256(`360dialog-conversation:${phoneNumberId || "unknown"}:${contactId}`);

function envelopeForMessage({ message, value, eventType, now }) {
  const humanEcho = eventType === "smb_message_echoes";
  const contactId = humanEcho ? message?.to : message?.from;
  if (!message?.id || !contactId) throw new Error("Mensaje 360dialog sin identificadores requeridos.");
  const phoneNumberId = value?.metadata?.phone_number_id || value?.phone_number_id || value?.id || "unknown";
  const occurredAt = toIso(message.timestamp);
  const ageSeconds = Math.floor((now.getTime() - new Date(occurredAt).getTime()) / 1000);
  return validateShadowEnvelope({
    provider: "360dialog",
    externalEventId: `${eventType}:${message.id}`,
    externalMessageId: message.id,
    externalConversationId: stableConversationId(phoneNumberId, contactId),
    externalContactId: contactId,
    direction: humanEcho ? "outbound" : "inbound",
    occurredAt,
    channel: "whatsapp_administracion",
    sanitizedText: messageText(message),
    attachmentMetadata: attachmentMetadata(message),
    providerMetadata: {
      eventType,
      humanEcho,
      phoneNumberIdHash: phoneNumberId === "unknown" ? "unknown" : sha256(`360dialog-phone:${phoneNumberId}`),
      messageType: message.type || "unknown",
      outOfOrder: ageSeconds > 5 * 60,
      area: "administracion",
    },
  });
}

function standardMessageEvents(payload) {
  const events = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      if (change?.field !== "messages" || !Array.isArray(value.messages)) continue;
      events.push({ value, messages: value.messages, eventType: "messages", externalEventId: payload.id || entry.id });
    }
  }
  return events;
}

function coexistenceEchoEvents(payload) {
  const events = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const messages = value.message_echoes || [];
      if (change?.field !== "smb_message_echoes" || !Array.isArray(messages)) continue;
      events.push({ value, messages, eventType: "smb_message_echoes", externalEventId: payload.id || entry.id });
    }
  }
  return events;
}

export function transform360DialogWebhook(payload, { now = new Date(), maxEventAgeSeconds = DEFAULT_360DIALOG_MAX_EVENT_AGE_SECONDS } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Payload 360dialog inválido.");
  const eventGroups = [...standardMessageEvents(payload), ...coexistenceEchoEvents(payload)];
  if (!eventGroups.length) {
    const hasStatuses = (payload.entry || []).some((entry) => (entry.changes || []).some((change) => Array.isArray(change?.value?.statuses)));
    return { kind: hasStatuses ? "status" : "ignored", envelopes: [] };
  }
  const envelopes = eventGroups.flatMap((group) => group.messages.map((message) => envelopeForMessage({ ...group, message, now })));
  for (const envelope of envelopes) {
    const ageSeconds = (now.getTime() - new Date(envelope.occurredAt).getTime()) / 1000;
    if (ageSeconds > maxEventAgeSeconds || ageSeconds < -MAX_FUTURE_SKEW_SECONDS) throw new Error("Evento 360dialog fuera de ventana temporal.");
  }
  return { kind: "messages", envelopes };
}

export function payloadSizeBytes(payload) {
  return Buffer.byteLength(JSON.stringify(payload ?? null));
}

export function safeSecretEqual(received, expected) {
  const left = Buffer.from(String(received || ""));
  const right = Buffer.from(String(expected || ""));
  return Boolean(left.length && right.length && left.length === right.length && crypto.timingSafeEqual(left, right));
}

export function assert360DialogInboundOnly() {
  return Object.freeze({ outboundImplemented: false, mediaDownloadImplemented: false, llmImplemented: false });
}
