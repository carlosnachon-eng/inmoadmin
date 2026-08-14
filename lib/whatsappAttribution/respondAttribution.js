import { extractRespondWebhookEvent } from "../ejecutivo/respondWebhook";

export const WHATSAPP_ATTRIBUTION_REFERENCE_PATTERN =
  /(?:^|\s)Ref:\s*([0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3})(?=$|\s|[.,!?;:])/gi;
export const WHATSAPP_ATTRIBUTION_TIMEOUT_MS = 750;

export function whatsappAttributionEnabled(env = process.env) {
  return String(env.WHATSAPP_ATTRIBUTION_ENABLED || "").trim().toLowerCase() === "true";
}

export function incomingRespondText(body) {
  if (String(body?.event_type || body?.event || "") !== "message.received") return null;
  if (String(body?.message?.traffic || "").toLowerCase() !== "incoming") return null;
  const content = body?.message?.message;
  if (String(content?.type || "").toLowerCase() !== "text") return null;
  return typeof content?.text === "string" ? content.text : null;
}

export function extractWhatsappAttributionReference(text) {
  if (typeof text !== "string" || text.length > 16_000) return null;
  const found = new Set();
  WHATSAPP_ATTRIBUTION_REFERENCE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(WHATSAPP_ATTRIBUTION_REFERENCE_PATTERN)) {
    found.add(match[1].toUpperCase());
    if (found.size > 1) return null;
  }
  return found.size === 1 ? [...found][0] : null;
}

export function extractAttributionObservation(body) {
  const event = extractRespondWebhookEvent(body);
  const text = incomingRespondText(body);
  const referenceCode = extractWhatsappAttributionReference(text);
  if (!event.supported || event.eventType !== "message.received" || !referenceCode) return null;
  if (!event.eventId || !event.respondContactId) return null;
  return Object.freeze({
    referenceCode,
    webhookEventId: event.eventId,
    respondContactId: event.respondContactId,
    messageId: event.messageId,
    occurredAt: event.eventOccurredAt,
  });
}

export async function persistAttributionObservation(admin, observation) {
  const { data, error } = await admin.rpc("observe_whatsapp_attribution_message", {
    p_reference_code: observation.referenceCode,
    p_webhook_event_id: observation.webhookEventId,
    p_respond_contact_id: observation.respondContactId,
    p_message_id: observation.messageId,
    p_event_occurred_at: observation.occurredAt,
  });
  if (error) throw error;
  return data || { status: "unknown" };
}

export async function observeWhatsappAttributionFailOpen({
  admin,
  body,
  env = process.env,
  logger = console,
  timeoutMs = WHATSAPP_ATTRIBUTION_TIMEOUT_MS,
} = {}) {
  if (!whatsappAttributionEnabled(env)) return { status: "disabled" };

  let timeout;
  try {
    const observation = extractAttributionObservation(body);
    if (!observation) return { status: "ignored" };

    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error("Attribution storage timeout");
        error.code = "storage_timeout_fail_open";
        reject(error);
      }, Math.max(1, Number(timeoutMs) || WHATSAPP_ATTRIBUTION_TIMEOUT_MS));
    });
    return await Promise.race([
      persistAttributionObservation(admin, observation),
      timeoutPromise,
    ]);
  } catch (error) {
    logger?.error?.("[respond-whatsapp-attribution]", error?.code || "storage_failed_open");
    return { status: "storage_failed_open" };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
