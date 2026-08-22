import { sanitizeShadowText } from "../coordinator.js";

export const REAL_SHADOW_ADMIN_CHANNEL_ID = "544519";
export const REAL_SHADOW_DEV_CLONE_MARKER = "FASE2A-REAL-MANUAL-DEV-QA";
const QA_TEXT_MARKER = /^(?:PRUEBA SHADOW\b|RECIBIDO SHADOW\b|FASE2A-)/i;
const QA_ID_MARKER = /(?:FASE2A-|\bp3-(?:reg-)?\d{2}\b|fixture|synthetic|\bsmoke\b|\bqa\b)/i;
const QA_METADATA_KEYS = /(?:^|_)(?:qa|synthetic|test|fixture|smoke)(?:_|$)/i;

function hasQaMetadata(value, key = "", depth = 0) {
  if (depth > 4 || value == null) return false;
  if (QA_METADATA_KEYS.test(key) && value !== false && value !== "false" && value !== "production") return true;
  if (typeof value === "string") return QA_ID_MARKER.test(value);
  if (Array.isArray(value)) return value.some((item) => hasQaMetadata(item, key, depth + 1));
  if (typeof value === "object") return Object.entries(value).some(([childKey, child]) => hasQaMetadata(child, childKey, depth + 1));
  return false;
}

export function isRealShadowQaMessage(message) {
  return Boolean(
    QA_TEXT_MARKER.test(String(message?.sanitized_text || "").trim())
    || QA_ID_MARKER.test(String(message?.external_message_id || ""))
    || hasQaMetadata(message?.provider_metadata || {})
  );
}

export function realShadowMessageEligibility({ message, conversation, env = process.env }) {
  if (!message || !conversation) return { allowed: false, reason: "message_not_found" };
  if (message.direction !== "inbound") return { allowed: false, reason: "inbound_required" };
  if (conversation.provider !== "respond_admin") return { allowed: false, reason: "provider_not_allowed" };
  const expected = String(env.SHADOW_RESPOND_ADMIN_CHANNEL_ID || REAL_SHADOW_ADMIN_CHANNEL_ID);
  if (expected !== REAL_SHADOW_ADMIN_CHANNEL_ID || String(conversation.channel) !== expected) return { allowed: false, reason: "channel_not_allowed" };
  if (isRealShadowQaMessage(message)) return { allowed: false, reason: "synthetic_or_qa" };
  const sanitized = sanitizeShadowText(message.sanitized_text);
  if (sanitized.rejected || sanitized.changed || sanitized.text !== message.sanitized_text) return { allowed: false, reason: "message_not_sanitized" };
  if ((message.attachment_metadata || []).some((item) => item?.url || item?.data || item?.content)) return { allowed: false, reason: "unsafe_attachment_metadata" };
  return { allowed: true, reason: "eligible" };
}

export function realShadowDevCloneEligibility({ message, conversation, env = process.env }) {
  if (!message || !conversation) return { allowed: false, reason: "message_not_found" };
  const projectRef = String(env.NEXT_PUBLIC_SUPABASE_URL || "").match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i)?.[1] || null;
  if (env.VERCEL_ENV !== "preview" || env.SUPABASE_ENVIRONMENT !== "dev" || projectRef !== "hjfwjnejbcpmknvfpdcq") return { allowed: false, reason: "dev_test_environment_required" };
  if (env.SHADOW_REAL_MANUAL_DEV_TEST_ENABLED !== "true" || env.SHADOW_AI_ALLOW_REAL_MESSAGES === "true" || env.SHADOW_AI_PRODUCTION_ENABLED === "true" || env.SHADOW_OUTBOUND_ENABLED === "true") return { allowed: false, reason: "dev_test_flags_blocked" };
  if (message.direction !== "inbound") return { allowed: false, reason: "inbound_required" };
  if (conversation.provider !== "respond_admin" || String(conversation.channel) !== REAL_SHADOW_ADMIN_CHANNEL_ID) return { allowed: false, reason: "channel_not_allowed" };
  if (message.provider_metadata?.realManualDevClone !== REAL_SHADOW_DEV_CLONE_MARKER || String(message.external_message_id || "") !== REAL_SHADOW_DEV_CLONE_MARKER) return { allowed: false, reason: "dev_clone_marker_required" };
  const sanitized = sanitizeShadowText(message.sanitized_text);
  if (sanitized.rejected || sanitized.changed || sanitized.text !== message.sanitized_text) return { allowed: false, reason: "message_not_sanitized" };
  if ((message.attachment_metadata || []).some((item) => item?.url || item?.data || item?.content)) return { allowed: false, reason: "unsafe_attachment_metadata" };
  return { allowed: true, reason: "eligible_dev_clone" };
}

export function realShadowEnvelope(message, conversation) {
  return {
    provider: "respond_admin",
    direction: "inbound",
    sanitizedText: message.sanitized_text,
    occurredAt: message.occurred_at,
    externalMessageId: message.external_message_id,
    providerMetadata: { ...(message.provider_metadata || {}), channelId: String(conversation.channel) },
  };
}

export async function loadRealShadowMessage(admin, messageId) {
  const { data: message, error } = await admin.from("shadow_messages")
    .select("id,conversation_id,direction,occurred_at,sanitized_text,attachment_metadata,provider_metadata,external_message_id")
    .eq("id", messageId).maybeSingle();
  if (error) throw error;
  const { data: conversation, error: conversationError } = message
    ? await admin.from("shadow_conversations").select("id,provider,channel").eq("id", message.conversation_id).maybeSingle()
    : { data: null, error: null };
  if (conversationError) throw conversationError;
  return { message, conversation };
}
