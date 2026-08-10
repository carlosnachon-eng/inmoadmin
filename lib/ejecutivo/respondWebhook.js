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

export function isValidRespondWebhookSignature(body, signature, signingKey) {
  if (!body || !signature || !signingKey) return false;
  const expected = createHmac("sha256", signingKey)
    .update(JSON.stringify(body))
    .digest("base64");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(String(signature).trim(), "utf8");
  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer);
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
  const eventOccurredAt = isoTimestamp(
    message?.timestamp
    || conversation?.closedTime
    || conversation?.openedTime
    || body?.timestamp
  );

  const payloadMeta = {};
  if (message?.traffic) payloadMeta.traffic = String(message.traffic);
  if (message?.sender?.source) payloadMeta.sender_source = String(message.sender.source);
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
    payloadMeta,
  };
}
