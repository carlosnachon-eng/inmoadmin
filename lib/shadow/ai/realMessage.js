import { sanitizeShadowText } from "../coordinator.js";

export const REAL_SHADOW_ADMIN_CHANNEL_ID = "544519";
const QA_MARKER = /(?:FASE2A-|\bp3-(?:reg-)?\d{2}\b|fixture|synthetic)/i;

export function realShadowMessageEligibility({ message, conversation, env = process.env }) {
  if (!message || !conversation) return { allowed: false, reason: "message_not_found" };
  if (message.direction !== "inbound") return { allowed: false, reason: "inbound_required" };
  if (conversation.provider !== "respond_admin") return { allowed: false, reason: "provider_not_allowed" };
  const expected = String(env.SHADOW_RESPOND_ADMIN_CHANNEL_ID || REAL_SHADOW_ADMIN_CHANNEL_ID);
  if (expected !== REAL_SHADOW_ADMIN_CHANNEL_ID || String(conversation.channel) !== expected) return { allowed: false, reason: "channel_not_allowed" };
  if (message.provider_metadata?.syntheticScenario || QA_MARKER.test(String(message.external_message_id || "")) || QA_MARKER.test(String(message.sanitized_text || ""))) return { allowed: false, reason: "synthetic_or_qa" };
  const sanitized = sanitizeShadowText(message.sanitized_text);
  if (sanitized.rejected || sanitized.changed || sanitized.text !== message.sanitized_text) return { allowed: false, reason: "message_not_sanitized" };
  if ((message.attachment_metadata || []).some((item) => item?.url || item?.data || item?.content)) return { allowed: false, reason: "unsafe_attachment_metadata" };
  return { allowed: true, reason: "eligible" };
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
