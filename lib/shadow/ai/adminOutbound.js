import { semanticConversationGuard, SHADOW_ADMIN_OUTBOUND_ACTIONS } from "./conversationAction.js";

export const SHADOW_ADMIN_CHANNEL_ID = "544519";
export const SHADOW_ADMIN_OUTBOUND_LIMIT = 10;
export const SHADOW_ADMIN_OUTBOUND_MIN_CONFIDENCE = 0.75;
const clean = (value, max = 160) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

export function adminOutboundCapabilities(env = process.env) {
  return { enabled: env.SHADOW_ADMIN_OUTBOUND_ENABLED === "true", globalOutboundEnabled: env.SHADOW_OUTBOUND_ENABLED === "true", channelId: clean(env.SHADOW_RESPOND_ADMIN_CHANNEL_ID || SHADOW_ADMIN_CHANNEL_ID, 40) };
}

export function assertAdminOutboundEnvironment(env = process.env) {
  const state = adminOutboundCapabilities(env);
  if (!state.enabled) throw Object.assign(new Error("admin_outbound_disabled"), { statusCode: 409 });
  if (state.globalOutboundEnabled) throw Object.assign(new Error("global_outbound_must_remain_disabled"), { statusCode: 409 });
  if (state.channelId !== SHADOW_ADMIN_CHANNEL_ID) throw Object.assign(new Error("admin_channel_not_allowlisted"), { statusCode: 409 });
  if (!env.RESPOND_IO_TOKEN && !env.RESPOND_IO_API_TOKEN) throw Object.assign(new Error("respond_sender_credential_missing"), { statusCode: 503 });
  return state;
}

export function validateAdminOutboundClaim(claim, { now = Date.now() } = {}) {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) return { allowed: false, reason: "no_work" };
  if (!claim.outbound_id || !claim.action_id || !claim.message_id || !claim.conversation_id || !claim.respond_contact_id || !claim.anchor_occurred_at) return { allowed: false, reason: "invalid_claim_shape" };
  if (String(claim.channel_id) !== SHADOW_ADMIN_CHANNEL_ID) return { allowed: false, reason: "channel_not_allowlisted" };
  if (!SHADOW_ADMIN_OUTBOUND_ACTIONS.includes(claim.conversation_action)) return { allowed: false, reason: "action_not_allowlisted" };
  if (claim.interaction_direction !== "inbound_customer_action") return { allowed: false, reason: "interaction_direction_not_customer_inbound" };
  if (claim.auto_send_eligible !== true || claim.requires_human === true) return { allowed: false, reason: "not_auto_send_eligible" };
  if (Number(claim.confidence) < SHADOW_ADMIN_OUTBOUND_MIN_CONFIDENCE) return { allowed: false, reason: "low_confidence" };
  const message = clean(claim.proposed_message, 481);
  if (!message || message.length > 480) return { allowed: false, reason: "invalid_message" };
  if (!claim.expires_at || Date.parse(claim.expires_at) <= now) return { allowed: false, reason: "expired" };
  const semantic = semanticConversationGuard(message);
  if (!semantic.allowed) return semantic;
  return { allowed: true, reason: null };
}

export async function sendRespondAdminText({ contactId, text, channelId = SHADOW_ADMIN_CHANNEL_ID, env = process.env, fetchImpl = fetch }) {
  assertAdminOutboundEnvironment(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(`https://api.respond.io/v2/contact/id:${encodeURIComponent(String(contactId))}/message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESPOND_IO_TOKEN || env.RESPOND_IO_API_TOKEN}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: Number(channelId), message: { type: "text", text: clean(text, 480) } }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status >= 500 || response.status === 429 ? "respond_delivery_unknown" : "respond_rejected");
    if (!body?.messageId) throw new Error("respond_delivery_unknown");
    return { providerMessageId: clean(body.messageId, 120) };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("respond_delivery_unknown");
    throw error;
  } finally { clearTimeout(timeout); }
}

async function defaultClaim(admin, workerId) {
  const { data, error } = await admin.rpc("claim_shadow_admin_outbound", { p_worker_id: workerId });
  if (error) throw Object.assign(new Error("admin_outbound_claim_failed"), { cause: error });
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function recheckNoNewMessage(admin, claim) {
  const { data, error } = await admin.from("shadow_messages").select("id,direction,occurred_at").eq("conversation_id", claim.conversation_id).gt("occurred_at", claim.anchor_occurred_at).order("occurred_at", { ascending: true }).limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}

async function finish(admin, claim, values) {
  const { error } = await admin.from("shadow_admin_outbound_messages").update(values).eq("id", claim.outbound_id).eq("status", "processing");
  if (error) throw error;
}

export async function processOneAdminOutbound(admin, { env = process.env, workerId = `admin-outbound-${Date.now()}`, claim = defaultClaim, send = sendRespondAdminText, recheck = recheckNoNewMessage } = {}) {
  assertAdminOutboundEnvironment(env);
  const item = await claim(admin, workerId);
  if (!item) return { status: "no_work" };
  const validation = validateAdminOutboundClaim(item);
  if (!validation.allowed) {
    await finish(admin, item, { status: "blocked", error_code: validation.reason, completed_at: new Date().toISOString() });
    await admin.from("shadow_conversation_actions").update({ status: "rejected", auto_send_eligible: false, blocked_reason: validation.reason, updated_at: new Date().toISOString() }).eq("id", item.action_id).eq("status", "approved_for_future_auto");
    return { id: item.outbound_id, status: "blocked", reason: validation.reason };
  }
  let newerMessage;
  try { newerMessage = await recheck(admin, item); }
  catch {
    const now = new Date().toISOString();
    await finish(admin, item, { status: "blocked", error_code: "human_override_recheck_failed", completed_at: now });
    await admin.from("shadow_conversation_actions").update({ status: "rejected", auto_send_eligible: false, blocked_reason: "human_override_recheck_failed", updated_at: now }).eq("id", item.action_id).eq("status", "approved_for_future_auto");
    return { id: item.outbound_id, status: "blocked", reason: "human_override_recheck_failed" };
  }
  if (newerMessage) {
    const now = new Date().toISOString();
    await finish(admin, item, { status: "superseded", error_code: "new_message_after_action", completed_at: new Date().toISOString() });
    await admin.from("shadow_conversation_actions").update({ status: "superseded", auto_send_eligible: false, superseded_by_message_id: newerMessage.id, superseded_at: now, updated_at: now }).eq("id", item.action_id).eq("status", "approved_for_future_auto");
    return { id: item.outbound_id, status: "superseded" };
  }
  try {
    const result = await send({ contactId: item.respond_contact_id, text: item.proposed_message, channelId: item.channel_id, env });
    const sentAt = new Date().toISOString();
    await finish(admin, item, { status: "sent", provider_message_id: result.providerMessageId, sent_at: sentAt, completed_at: sentAt });
    const { error } = await admin.from("shadow_conversation_actions").update({ status: "sent", updated_at: sentAt }).eq("id", item.action_id).eq("status", "approved_for_future_auto");
    return { id: item.outbound_id, status: "sent", providerMessageId: result.providerMessageId, actionSyncError: Boolean(error) };
  } catch (error) {
    const code = error?.message === "respond_rejected" ? "respond_rejected" : "respond_delivery_unknown";
    await finish(admin, item, { status: code === "respond_rejected" ? "failed" : "delivery_unknown", error_code: code, completed_at: new Date().toISOString() });
    await admin.from("shadow_conversation_actions").update({ status: "rejected", auto_send_eligible: false, blocked_reason: code, updated_at: new Date().toISOString() }).eq("id", item.action_id).eq("status", "approved_for_future_auto");
    return { id: item.outbound_id, status: code === "respond_rejected" ? "failed" : "delivery_unknown", error: code };
  }
}
