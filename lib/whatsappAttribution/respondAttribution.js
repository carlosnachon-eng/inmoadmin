import { timingSafeEqual } from "crypto";

import { DEV_PROJECT_REF } from "../ejecutivo/workCenter";
import { extractRespondWebhookEvent } from "../ejecutivo/respondWebhook";

export const WHATSAPP_ATTRIBUTION_REFERENCE_PATTERN =
  /(?:^|\s)Ref:\s*([0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3})(?=$|\s|[.,!?;:])/gi;

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function projectRefFromUrl(value) {
  return String(value || "").trim().match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i)?.[1] || null;
}

function serviceRoleTargetsDev(value) {
  const key = String(value || "").trim();
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return claims.role === "service_role" && claims.ref === DEV_PROJECT_REF;
  } catch {
    return false;
  }
}

export function assertRespondAttributionPilotEnvironment(env = process.env) {
  if (normalize(env.VERCEL_ENV) !== "preview"
      || normalize(env.WHATSAPP_ATTRIBUTION_PILOT_ENABLED) !== "true") {
    const error = new Error("Not Found");
    error.statusCode = 404;
    throw error;
  }

  const projectRef = projectRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (projectRef !== DEV_PROJECT_REF
      || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      || !serviceRoleTargetsDev(env.SUPABASE_SERVICE_ROLE_KEY)) {
    const error = new Error("Unsafe attribution target");
    error.statusCode = 503;
    throw error;
  }
  return Object.freeze({ env: "preview", projectRef });
}

export function resolveRespondAttributionSigningKey(env = process.env) {
  const key = String(env.RESPOND_ATTRIBUTION_PILOT_SIGNING_KEY || "").trim();
  if (Buffer.byteLength(key, "utf8") < 16) {
    const error = new Error("Pilot signing key unavailable");
    error.statusCode = 503;
    throw error;
  }
  return key;
}

export function validPilotSignature(body, signature, signingKey, createHmac) {
  if (!body || !signature || !signingKey || typeof createHmac !== "function") return false;
  const expected = createHmac("sha256", signingKey)
    .update(JSON.stringify(body))
    .digest("base64");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(String(signature).trim(), "utf8");
  const comparable = expectedBuffer.length === receivedBuffer.length
    ? receivedBuffer
    : Buffer.alloc(expectedBuffer.length);
  const equal = timingSafeEqual(expectedBuffer, comparable);
  return expectedBuffer.length === receivedBuffer.length && equal;
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
