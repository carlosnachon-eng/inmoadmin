import { createHmac, timingSafeEqual } from "crypto";

export const RESPOND_SUPPORTED_WEBHOOK_EVENTS = new Set([
  "contact.created",
  "contact.updated",
  "contact.assignee.updated",
  "contact.lifecycle.updated",
  "conversation.opened",
  "conversation.closed",
  "message.received",
  "message.sent",
]);

const MAX_WEBHOOK_BYTES = 256 * 1024;
export const MAX_RESPOND_WEBHOOK_SIGNING_KEYS = 16;

function signingKeysConfigurationError() {
  const error = new Error("Configuracion de firma webhook invalida.");
  error.code = "respond_webhook_signing_keys_invalid";
  error.statusCode = 503;
  return error;
}

function normalizedLegacySigningKey(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

export function resolveRespondWebhookSigningKeys({
  signingKeysJson = process.env.RESPOND_WEBHOOK_SIGNING_KEYS,
  legacySigningKey = process.env.RESPOND_WEBHOOK_SIGNING_KEY,
} = {}) {
  const legacy = normalizedLegacySigningKey(legacySigningKey);

  if (signingKeysJson !== undefined && signingKeysJson !== null) {
    let parsed;
    try {
      parsed = JSON.parse(signingKeysJson);
    } catch {
      throw signingKeysConfigurationError();
    }

    if (!Array.isArray(parsed) || parsed.length > MAX_RESPOND_WEBHOOK_SIGNING_KEYS) {
      throw signingKeysConfigurationError();
    }
    if (parsed.some((key) => typeof key !== "string" || !key.trim())) {
      throw signingKeysConfigurationError();
    }

    const unique = [...new Set(parsed.map((key) => key.trim()))];
    if (unique.length) return unique;
    if (legacy) return [legacy];
    throw signingKeysConfigurationError();
  }

  if (legacy) return [legacy];
  throw signingKeysConfigurationError();
}

function isoTimestamp(value) {
  if (!value) return null;
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  let number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (number < 1e11) number *= 1000;
  if (number > 1e14) number = Math.floor(number / 1000);
  const parsed = new Date(number);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function readRespondWebhookBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_WEBHOOK_BYTES) {
      const error = new Error("Webhook body demasiado grande.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Webhook body invalido.");
    error.statusCode = 400;
    throw error;
  }
}

export function isValidRespondWebhookSignature(body, signature, signingKeys) {
  if (!body || !signature) return false;
  const candidates = (Array.isArray(signingKeys) ? signingKeys : [signingKeys])
    .filter((key) => typeof key === "string" && key.length > 0);
  if (!candidates.length) return false;

  const receivedBuffer = Buffer.from(String(signature).trim(), "utf8");
  let valid = false;

  for (const signingKey of candidates) {
    const expected = createHmac("sha256", signingKey)
      .update(JSON.stringify(body))
      .digest("base64");
    const expectedBuffer = Buffer.from(expected, "utf8");
    const comparableBuffer = expectedBuffer.length === receivedBuffer.length
      ? receivedBuffer
      : Buffer.alloc(expectedBuffer.length);
    const matches = timingSafeEqual(expectedBuffer, comparableBuffer);
    valid = valid || (expectedBuffer.length === receivedBuffer.length && matches);
  }

  return valid;
}

export function extractRespondWebhookEvent(body) {
  const eventType = String(body?.event_type || body?.event || "").trim();
  const eventId = String(body?.event_id || body?.eventId || "").trim();
  const contactId = body?.contact?.id
    ?? body?.message?.contactId
    ?? body?.conversation?.contactId
    ?? body?.contactId
    ?? null;
  const message = body?.message || null;
  const conversation = body?.conversation || null;
  const channelId = message?.channelId
    ?? conversation?.channelId
    ?? body?.channelId
    ?? body?.channel?.id
    ?? null;
  const eventOccurredAt = isoTimestamp(
    message?.timestamp
    || conversation?.closedTime
    || conversation?.openedTime
    || body?.timestamp
  );

  const payloadMeta = {};
  if (message?.traffic) payloadMeta.traffic = String(message.traffic);
  if (message?.sender?.source) payloadMeta.sender_source = String(message.sender.source);
  if (channelId !== null && channelId !== undefined && String(channelId).trim()) {
    payloadMeta.channel_id = String(channelId).trim().slice(0, 80);
  }
  if (conversation?.status) payloadMeta.conversation_status = String(conversation.status);
  if (body?.action) payloadMeta.action = String(body.action);
  if (body?.oldLifecycle?.id) payloadMeta.old_lifecycle_id = String(body.oldLifecycle.id);
  if (body?.contact?.lifecycle?.id) payloadMeta.lifecycle_id = String(body.contact.lifecycle.id);
  if (body?.contact?.assignee?.id) payloadMeta.assignee_id = String(body.contact.assignee.id);

  return {
    eventId,
    eventType,
    supported: RESPOND_SUPPORTED_WEBHOOK_EVENTS.has(eventType),
    respondContactId: contactId === null || contactId === undefined ? null : String(contactId),
    eventOccurredAt,
    messageId: message?.messageId ? String(message.messageId) : null,
    channelId: channelId === null || channelId === undefined ? null : String(channelId),
    payloadMeta,
  };
}
