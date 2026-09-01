import { sanitizeShadowText, sha256, validateShadowEnvelope } from "../coordinator.js";
import { processShadowEnvelope } from "../pipeline.js";
import { contactPhoneFromRespondPayload, generateIdentityCandidates } from "../identityBridge.js";
import { reconcilePendingRespondOutgoingOrigins, respondOutgoingDirectionFromSenderSource } from "../outboundOrigin.js";

export { respondOutgoingDirectionFromSenderSource } from "../outboundOrigin.js";

const INBOUND_EVENTS = new Set(["message.received", "new_incoming_message"]);
const OUTBOUND_EVENTS = new Set(["message.sent", "new_outgoing_message"]);
const DEV_SUPABASE_REF = "hjfwjnejbcpmknvfpdcq";
const PRODUCTION_SUPABASE_REF = "bnzrnizrmonjxlktbhlp";
const MEDIA_PLACEHOLDERS = Object.freeze({
  image: "[IMAGEN]", document: "[DOCUMENTO]", audio: "[AUDIO]", video: "[VIDEO]",
  sticker: "[STICKER]", location: "[UBICACION]", contact: "[CONTACTO]", file: "[ARCHIVO]",
});
const MEDIA_TYPE_ALIASES = Object.freeze({
  image: "image", photo: "image", document: "document", pdf: "document",
  audio: "audio", voice: "audio", ptt: "audio", video: "video", sticker: "sticker",
  location: "location", contacts: "contact", contact: "contact", vcard: "contact",
  file: "file", attachment: "file",
});

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

function enabled(value) {
  return String(value).trim().toLowerCase() === "true";
}

export function supabaseProjectRef(value) {
  try {
    const url = new URL(String(value || ""));
    const labels = url.hostname.toLowerCase().split(".");
    if (url.protocol !== "https:" || labels.length !== 3 || labels[1] !== "supabase" || labels[2] !== "co") return null;
    return labels[0] || null;
  } catch {
    return null;
  }
}

export function authorizeRespondAdminCaptureEnvironment({
  vercelEnvironment = process.env.VERCEL_ENV,
  supabaseEnvironment = process.env.SUPABASE_ENVIRONMENT,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
  productionEnabled = process.env.SHADOW_RESPOND_ADMIN_PRODUCTION_ENABLED,
  outboundEnabled = process.env.SHADOW_OUTBOUND_ENABLED,
} = {}) {
  if (enabled(outboundEnabled)) return { allowed: false, reason: "outbound_enabled" };

  const vercelEnv = clean(vercelEnvironment, 20).toLowerCase();
  const supabaseEnv = clean(supabaseEnvironment, 20).toLowerCase();
  const projectRef = supabaseProjectRef(supabaseUrl);

  if (vercelEnv === "production" || supabaseEnv === "production") {
    if (vercelEnv !== "production" || supabaseEnv !== "production" || projectRef !== PRODUCTION_SUPABASE_REF) {
      return { allowed: false, reason: "production_environment_mismatch" };
    }
    if (!enabled(productionEnabled)) return { allowed: false, reason: "production_disabled" };
    return { allowed: true, environment: "production", projectRef };
  }

  if (!["preview", "development"].includes(vercelEnv) || supabaseEnv !== "dev" || projectRef !== DEV_SUPABASE_REF) {
    return { allowed: false, reason: "development_environment_mismatch" };
  }
  return { allowed: true, environment: "dev", projectRef };
}

export function respondAdminCaptureDecision(payload, options = {}) {
  const channelDecision = shouldCaptureRespondAdmin(payload, options);
  if (!channelDecision.capture) return channelDecision;
  const environmentDecision = authorizeRespondAdminCaptureEnvironment(options);
  if (!environmentDecision.allowed) return { capture: false, reason: environmentDecision.reason };
  return { ...channelDecision, ...environmentDecision, capture: true };
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

function sanitizedFilename(value) {
  const leaf = clean(value, 300).replace(/\\/g, "/").split("/").at(-1) || "";
  const sanitized = leaf.replace(/[\u0000-\u001f\u007f]/g, "").replace(/https?:\/\/\S+/gi, "").trim();
  const safe = sanitizeShadowText(sanitized.slice(0, 120));
  return safe.rejected ? null : safe.text;
}

function normalizedMime(value) {
  const mime = clean(value, 120).toLowerCase().split(";", 1)[0].trim();
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(mime) ? mime : null;
}

function mediaType(value) {
  return MEDIA_TYPE_ALIASES[clean(value, 40).toLowerCase()] || null;
}

function mediaCandidates(message) {
  const nested = message?.message && typeof message.message === "object" ? message.message : {};
  const arrays = [message?.attachments, nested?.attachments].flatMap((value) => Array.isArray(value) ? value : []);
  const singular = [message?.attachment, message?.media, message?.file, nested?.attachment, nested?.media, nested?.file]
    .filter((value) => value && typeof value === "object" && !Array.isArray(value));
  const hasTopLevelMedia = [message?.type, nested?.type].some((value) => mediaType(value));
  return [...arrays, ...singular, ...(hasTopLevelMedia && !arrays.length && !singular.length ? [message] : [])].slice(0, 5);
}

function safeMediaReference(candidate) {
  const value = candidate?.id ?? candidate?.mediaId ?? candidate?.media_id ?? candidate?.fileId ?? candidate?.file_id;
  return value === undefined || value === null || !clean(value, 300) ? null : sha256(clean(value, 300));
}

function attachmentMetadata(message) {
  const nested = message?.message && typeof message.message === "object" ? message.message : {};
  const messageType = mediaType(message?.type ?? nested?.type);
  const rawCaption = clean(message?.caption ?? nested?.caption, 2000);
  const sanitizedCaption = sanitizeShadowText(rawCaption);
  const caption = sanitizedCaption.rejected ? "" : sanitizedCaption.text;
  const candidates = mediaCandidates(message);
  return candidates.map((candidate) => {
    const type = mediaType(candidate?.type ?? candidate?.message?.type) || messageType || "file";
    const mimeType = normalizedMime(candidate?.mimeType ?? candidate?.mime_type ?? candidate?.contentType ?? candidate?.content_type);
    const fileName = sanitizedFilename(candidate?.fileName ?? candidate?.filename ?? candidate?.name);
    const sizeValue = Number(candidate?.size ?? candidate?.fileSize ?? candidate?.file_size);
    const referenceHash = safeMediaReference(candidate);
    return {
      type,
      ...(mimeType ? { mimeType } : {}),
      ...(fileName ? { fileName } : {}),
      ...(Number.isSafeInteger(sizeValue) && sizeValue >= 0 ? { size: sizeValue } : {}),
      ...(caption ? { caption } : {}),
      ...(referenceHash ? { referenceHash } : {}),
    };
  });
}

function messageContent(message) {
  const rawText = clean(textFromMessage(message), 4000);
  const rawCaption = clean(message?.caption ?? message?.message?.caption, 2000);
  const sanitizedText = sanitizeShadowText(rawText);
  const sanitizedCaption = sanitizeShadowText(rawCaption);
  const text = sanitizedText.rejected ? "" : sanitizedText.text;
  const caption = sanitizedCaption.rejected ? "" : sanitizedCaption.text;
  const attachments = attachmentMetadata(message);
  const prose = [text, caption].filter((value, index, values) => value && values.indexOf(value) === index);
  const placeholders = [...new Set(attachments.map((item) => MEDIA_PLACEHOLDERS[item.type] || MEDIA_PLACEHOLDERS.file))];
  return {
    text: [...prose, ...placeholders].join("\n"),
    rawTextPresent: Boolean(text || caption),
    attachments,
    disposition: attachments.length
      ? (prose.length ? "text_with_supported_media" : "supported_media_without_text")
      : (clean(message?.type ?? message?.message?.type, 40) && !["text", ""].includes(clean(message?.type ?? message?.message?.type, 40).toLowerCase())
        ? "unsupported_media" : "empty_text_no_supported_media"),
  };
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
  const direction = INBOUND_EVENTS.has(decision.eventType)
    ? "inbound"
    : respondOutgoingDirectionFromSenderSource(message.sender?.source);
  const content = messageContent(message);
  const sanitizedText = content.text;
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
    attachmentMetadata: content.attachments,
    rejectionReason: content.attachments.length || content.rawTextPresent ? null : content.disposition,
    providerMetadata: {
      respondContactId: contactId,
      eventType: decision.eventType,
      messageType: content.attachments[0]?.type || message.type || message.message?.type,
      senderSource: message.sender?.source,
      echoGatePending: direction !== "inbound" && direction !== "outbound_ai_inmoadmin",
      contentDisposition: content.disposition,
      hasUninterpretedAttachments: content.attachments.length > 0,
      attachmentTypes: [...new Set(content.attachments.map((item) => item.type))].join(","),
    },
    payloadFingerprint,
  });
}

export async function resolveRespondOutgoingOrigin(admin, envelope) {
  if (!envelope || envelope.direction === "inbound") return envelope;
  const providerMessageId = clean(envelope.externalMessageId, 200);
  if (!providerMessageId) return {
    ...envelope,
    direction: "outbound_unknown",
    providerMetadata: { ...envelope.providerMetadata, resolvedOrigin: "unknown", originResolution: "missing_provider_message_id", echoGatePending: true },
  };
  try {
    const { data, error } = await admin.from("shadow_admin_outbound_messages")
      .select("id,status,provider_message_id").eq("provider_message_id", providerMessageId).limit(2);
    if (error) throw error;
    if ((data || []).length === 1) return {
      ...envelope,
      direction: "outbound_ai_inmoadmin",
      providerMetadata: { ...envelope.providerMetadata, resolvedOrigin: "inmoadmin_admin_ai", originResolution: "provider_message_id_exact_match", echoGatePending: false },
    };
    if ((data || []).length > 1) return {
      ...envelope,
      direction: "outbound_unknown",
      providerMetadata: { ...envelope.providerMetadata, resolvedOrigin: "unknown", originResolution: "provider_message_id_conflict", echoGatePending: true },
    };
    return {
      ...envelope,
      direction: "outbound_unknown",
      providerMetadata: { ...envelope.providerMetadata, resolvedOrigin: "unknown", originResolution: "provider_message_id_pending", echoGatePending: true },
    };
  } catch {
    return {
      ...envelope,
      direction: "outbound_unknown",
      providerMetadata: { ...envelope.providerMetadata, resolvedOrigin: "unknown", originResolution: "provider_message_lookup_failed", echoGatePending: true },
    };
  }
}

export async function captureRespondAdminShadowIsolated(admin, payload, {
  timeoutMs = 800,
  processEnvelope = processShadowEnvelope,
} = {}) {
  const decision = respondAdminCaptureDecision(payload);
  if (!decision.capture) return { status: "skipped", reason: decision.reason };
  try {
    const result = await Promise.race([
      (async () => {
        const envelope = await resolveRespondOutgoingOrigin(admin, transformRespondAdminPayload(payload));
        const result = await processEnvelope(admin, envelope);
        if (result?.status === "duplicate" && envelope.externalMessageId) {
          await reconcilePendingRespondOutgoingOrigins(admin, { providerMessageId: envelope.externalMessageId });
        }
        return result;
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("respond_admin_shadow_timeout")), timeoutMs)),
    ]);
    if (result?.status === "accepted") {
      const normalizedPhone = contactPhoneFromRespondPayload(payload);
      if (normalizedPhone) {
        try { await generateIdentityCandidates(admin, { respondContactId: payload?.contact?.id || payload?.message?.contactId, normalizedPhone }); }
        catch { /* candidato aislado; nunca bloquea captura */ }
      }
    }
    return result;
  } catch (error) {
    console.error("[respond-admin-shadow-isolated]", error?.message || "shadow_error");
    return { status: "isolated_error" };
  }
}
