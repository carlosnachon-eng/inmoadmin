import { isShortSocialCta, SOCIAL_CTA_CLARIFICATION, SOCIAL_INVENTORY_CLARIFICATION } from "../social/commercialIntent.js";

export const LINK_ALTERNATIVE = "Recibí el enlace, pero no puedo identificar la propiedad con certeza. ¿Cuál es el nombre del edificio o la colonia?";
const millis = value => new Date(value || 0).getTime();
const norm = text => String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
export const isReferenceClarification = text => [SOCIAL_CTA_CLARIFICATION, SOCIAL_INVENTORY_CLARIFICATION, LINK_ALTERNATIVE].some(value => norm(value) === norm(text));
export const hasSalesProfileContext = profile => Boolean(profile?.inm_zona || profile?.inm_tipo || profile?.ven_plazo);

// Local journal is authoritative for burst absorption. Respond history enriches it,
// never replaces it. Same channel, bounded window, no historical turn re-execution.
export async function readSalesConversation(db, inbound, { notBefore = null } = {}) {
  if (!Number.isFinite(millis(inbound.occurred_at)) || !inbound.occurred_at)
    return { history: [inbound], burstText: inbound.sanitized_text, hasContext: false, sent: [], linkSeen: /\[URL\]/i.test(inbound.sanitized_text), clarificationSent: false };
  const cutoff = new Date(millis(inbound.occurred_at) - 24 * 60 * 60 * 1000).toISOString();
  const recent = await db.from("sales_agent_v2_inbound_messages")
    .select("id,occurred_at,created_at,sanitized_text,status").eq("respond_contact_id", inbound.respond_contact_id)
    .eq("channel_id", String(inbound.channel_id)).gte("occurred_at", cutoff).lte("occurred_at", inbound.occurred_at)
    .order("occurred_at", { ascending: false }).limit(20);
  if (recent.error) throw recent.error;
  // Dispatch can require fresh intent after an activation cut; ordinary
  // conversation processing keeps its existing history semantics.
  const history = (recent.data || []).filter(row => row.id !== inbound.id && (!notBefore || (
    millis(row.occurred_at) > millis(notBefore) && millis(row.created_at) > millis(notBefore)
  ))).reverse().concat(inbound);
  const deliveries = await db.from("sales_agent_v2_auto_outbound")
    .select("inbound_message_id,proposed_message,sent_at").eq("respond_contact_id", inbound.respond_contact_id)
    .eq("channel_id", String(inbound.channel_id)).eq("status", "sent")
    .gte("sent_at", cutoff).lte("sent_at", inbound.occurred_at).order("sent_at", { ascending: false }).limit(20);
  if (deliveries.error) throw deliveries.error;
  const sent = deliveries.data || [];
  const latestSend = Math.max(0, ...sent.map(row => millis(row.sent_at)));
  const burst = history.filter(row => row.id === inbound.id || (
    ["skipped", "captured", "processing", "processed"].includes(row.status)
    && millis(row.occurred_at) > latestSend && millis(inbound.occurred_at) - millis(row.occurred_at) <= 30_000
  ));
  return { history, sent, burstText: burst.map(row => row.sanitized_text).join("\n"),
    hasContext: history.length > 1 || sent.length > 0,
    linkSeen: history.some(row => /\[URL\]/i.test(row.sanitized_text)),
    clarificationSent: sent.some(row => isReferenceClarification(row.proposed_message)),
    alternativeSent: sent.some(row => norm(row.proposed_message) === norm(LINK_ALTERNATIVE)) };
}

export function isolatedSalesCta(text, conversation, sourceProperty) {
  return !sourceProperty && !conversation.hasContext && isShortSocialCta(text)
    && !/^(?:hol[ai]+!?|en\s+.+)$/i.test(String(text||"").trim())
    && !/\b(?:renta|compra|venta|informaci[oó]n|informes|disponible|casa|departamento|inmueble)\b/i.test(text);
}

// Do not replace a model answer simply because its *last fragment* is short.
// A link that cannot be resolved gets one alternative question, then visible review.
export function salesClarificationPolicy(text, conversation, sourceProperty) {
  if (sourceProperty) return { output: text };
  const asksLink = /(?:comparte|compartes|compartir|manda|envia|tienes).{0,40}(?:enlace|link)/i
    .test(norm(text).normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  if (conversation.linkSeen && (asksLink || isReferenceClarification(text))) {
    if (conversation.alternativeSent) return { output: "", reviewReason: "unresolved_reference_requires_review" };
    return { output: LINK_ALTERNATIVE };
  }
  if (conversation.clarificationSent && isReferenceClarification(text))
    return { output: "", reviewReason: "repeated_clarification_requires_review" };
  return { output: text };
}
