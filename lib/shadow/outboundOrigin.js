const ORIGIN_BY_DIRECTION = Object.freeze({
  outbound_ai_inmoadmin: "inmoadmin_admin_ai",
  outbound_human: "human",
  outbound_respond_ai: "respond_ai",
  outbound_unknown: "unknown",
  outbound: "unknown",
  inbound: "contact",
});

export const sanitizedProviderMessageRef = (value) => value ? `${String(value).slice(0, 8)}…` : null;

export function resolvePersistedShadowMessageOrigin(message, outboundByProviderMessageId = new Map()) {
  const matchedOutbound = message?.external_message_id
    ? outboundByProviderMessageId.get(String(message.external_message_id)) || null
    : null;
  if (matchedOutbound) return {
    resolved_direction: "outbound_ai_inmoadmin",
    message_origin: "inmoadmin_admin_ai",
    origin_resolution: "provider_message_id_exact_match",
    provider_message_ref: sanitizedProviderMessageRef(message.external_message_id),
  };
  const direction = String(message?.direction || "outbound_unknown");
  return {
    resolved_direction: direction,
    message_origin: ORIGIN_BY_DIRECTION[direction] || "unknown",
    origin_resolution: message?.provider_metadata?.originResolution || (direction === "inbound" ? "provider_direction" : "persisted_direction"),
    provider_message_ref: null,
  };
}
