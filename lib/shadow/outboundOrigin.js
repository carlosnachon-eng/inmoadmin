const ORIGIN_BY_DIRECTION = Object.freeze({
  outbound_ai_inmoadmin: "inmoadmin_admin_ai",
  outbound_human: "human",
  outbound_respond_ai: "respond_ai",
  outbound_unknown: "unknown",
  outbound: "unknown",
  inbound: "contact",
});

const REASON_BY_DIRECTION = Object.freeze({
  outbound_ai_inmoadmin: "inmoadmin_sender_echo",
  outbound_human: "human_app_echo",
  outbound_respond_ai: "respond_ai_echo",
});

export const RESPOND_OUTBOUND_ORIGIN_SETTLE_MS = 30_000;

const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);

export function respondOutgoingDirectionFromSenderSource(value) {
  const source = clean(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (["user", "human", "agent", "contact_owner"].includes(source)) return "outbound_human";
  if (["ai_agent", "aiagent", "workflow", "automation", "bot"].includes(source)) return "outbound_respond_ai";
  return "outbound_unknown";
}

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

export function pendingRespondOutgoingOriginDecision({ message, outboundMatches = [], now = Date.now(), settleMs = RESPOND_OUTBOUND_ORIGIN_SETTLE_MS } = {}) {
  if (message?.direction !== "outbound_unknown") return { status: "final", direction: message?.direction || "outbound_unknown", reason: "already_attributed" };
  if (outboundMatches.length === 1) return { status: "resolved", direction: "outbound_ai_inmoadmin", origin: "inmoadmin_admin_ai", reason: "provider_message_id_exact_match" };
  if (outboundMatches.length > 1) return { status: "pending", direction: "outbound_unknown", origin: "unknown", reason: "provider_message_id_conflict" };
  const createdAt = Date.parse(String(message?.created_at || ""));
  if (!Number.isFinite(createdAt) || now - createdAt < settleMs) return { status: "pending", direction: "outbound_unknown", origin: "unknown", reason: "provider_message_id_pending" };
  const direction = respondOutgoingDirectionFromSenderSource(message?.provider_metadata?.senderSource);
  if (direction === "outbound_human") return { status: "resolved", direction, origin: "human", reason: "respond_sender_source_after_settlement" };
  if (direction === "outbound_respond_ai") return { status: "resolved", direction, origin: "respond_ai", reason: "respond_sender_source_after_settlement" };
  return { status: "pending", direction: "outbound_unknown", origin: "unknown", reason: "sender_evidence_insufficient" };
}

async function loadPendingRespondOutgoing(admin, { providerMessageId = null, limit = 50 } = {}) {
  let query = admin.from("shadow_messages")
    .select("id,conversation_id,external_message_id,direction,provider_metadata,created_at")
    .eq("provider", "respond_admin")
    .eq("direction", "outbound_unknown");
  query = providerMessageId
    ? query.eq("external_message_id", clean(providerMessageId, 200)).limit(1)
    : query.order("created_at", { ascending: true }).limit(Math.max(1, Math.min(100, Number(limit || 50))));
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadAdminOutboundEvidence(admin, providerMessageIds = []) {
  const ids = [...new Set(providerMessageIds.map((item) => clean(item, 200)).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await admin.from("shadow_admin_outbound_messages")
    .select("id,status,provider_message_id")
    .in("provider_message_id", ids);
  if (error) throw error;
  return data || [];
}

async function persistRespondOutgoingResolution(admin, message, resolution) {
  const providerMetadata = {
    ...(message.provider_metadata || {}),
    resolvedOrigin: resolution.origin,
    originResolution: resolution.reason,
    echoGatePending: false,
  };
  const { error } = await admin.from("shadow_messages").update({
    direction: resolution.direction,
    provider_metadata: providerMetadata,
    administrative_likelihood: "unknown",
    intent: "no_determinado",
    reason_codes: [REASON_BY_DIRECTION[resolution.direction]],
    requires_human: false,
  }).eq("id", message.id).eq("direction", "outbound_unknown");
  if (error) throw error;
}

export async function reconcilePendingRespondOutgoingOrigins(admin, {
  providerMessageId = null,
  limit = 50,
  now = Date.now(),
  settleMs = RESPOND_OUTBOUND_ORIGIN_SETTLE_MS,
  loadPending = loadPendingRespondOutgoing,
  loadEvidence = loadAdminOutboundEvidence,
  persistResolution = persistRespondOutgoingResolution,
} = {}) {
  const pending = await loadPending(admin, { providerMessageId, limit });
  const evidence = await loadEvidence(admin, pending.map((item) => item.external_message_id));
  const evidenceByProviderId = new Map();
  for (const item of evidence) {
    const id = clean(item?.provider_message_id, 200);
    if (id) evidenceByProviderId.set(id, [...(evidenceByProviderId.get(id) || []), item]);
  }
  const result = { scanned: pending.length, resolved: 0, pending: 0, ai: 0, respondAi: 0, human: 0 };
  for (const message of pending) {
    const decision = pendingRespondOutgoingOriginDecision({
      message,
      outboundMatches: evidenceByProviderId.get(clean(message.external_message_id, 200)) || [],
      now,
      settleMs,
    });
    if (decision.status !== "resolved") { result.pending += 1; continue; }
    await persistResolution(admin, message, decision);
    result.resolved += 1;
    if (decision.direction === "outbound_ai_inmoadmin") result.ai += 1;
    else if (decision.direction === "outbound_respond_ai") result.respondAi += 1;
    else if (decision.direction === "outbound_human") result.human += 1;
  }
  return result;
}
