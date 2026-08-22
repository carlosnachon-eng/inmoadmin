import { createHash } from "node:crypto";
import { REAL_SHADOW_ADMIN_CHANNEL_ID, isRealShadowQaMessage, realShadowMessageEligibility } from "./realMessage.js";

export const REAL_SHADOW_TURN_GAP_MS = 5 * 60 * 1000;
export const REAL_SHADOW_TURN_SETTLE_MS = 2 * 60 * 1000;

const time = (value) => new Date(value).getTime();
const turnHash = (conversationId, messageIds) => createHash("sha256").update(`${conversationId}:${messageIds.join(":")}`).digest("hex");

export function buildRealShadowConversationTurns({ messages = [], conversations = [], env = process.env, now = Date.now(), gapMs = REAL_SHADOW_TURN_GAP_MS, settleMs = REAL_SHADOW_TURN_SETTLE_MS }) {
  const conversationsById = new Map(conversations.filter((item) => item.provider === "respond_admin" && String(item.channel) === REAL_SHADOW_ADMIN_CHANNEL_ID).map((item) => [item.id, item]));
  const grouped = new Map();
  for (const message of messages) {
    if (!conversationsById.has(message.conversation_id)) continue;
    grouped.set(message.conversation_id, [...(grouped.get(message.conversation_id) || []), message]);
  }
  const turns = [];
  const close = (current, reason, humanResponseId = null) => {
    if (!current?.messages.length) return;
    const ids = current.messages.map((item) => item.id);
    const last = current.messages.at(-1);
    turns.push({
      turnKey: turnHash(current.conversationId, ids), conversationId: current.conversationId,
      messageIds: ids, anchorMessageId: last.id, firstInboundAt: current.messages[0].occurred_at,
      lastInboundAt: last.occurred_at, sanitizedText: current.messages.map((item) => item.sanitized_text).join("\n"),
      humanResponseId, closedReason: reason,
    });
  };
  for (const [conversationId, items] of grouped) {
    const conversation = conversationsById.get(conversationId); let current = null;
    for (const message of [...items].sort((a, b) => time(a.occurred_at) - time(b.occurred_at) || String(a.id).localeCompare(String(b.id)))) {
      if (message.direction === "inbound") {
        const eligibility = realShadowMessageEligibility({ message, conversation, env });
        if (!eligibility.allowed) { close(current, "excluded_message"); current = null; continue; }
        if (current && time(message.occurred_at) - time(current.messages.at(-1).occurred_at) > gapMs) { close(current, "inbound_gap"); current = null; }
        current ||= { conversationId, messages: [] };
        current.messages.push(message);
      } else if (current && message.direction === "outbound_human") {
        close(current, "human_response", message.id); current = null;
      } else if (current) {
        close(current, "direction_change"); current = null;
      }
    }
    if (current && now - time(current.messages.at(-1).occurred_at) >= settleMs) close(current, "settled");
  }
  return turns.sort((a, b) => time(a.lastInboundAt) - time(b.lastInboundAt));
}

export function realShadowTurnEnvelope(turn, conversation) {
  return {
    provider: "respond_admin", direction: "inbound", sanitizedText: turn.sanitizedText,
    occurredAt: turn.lastInboundAt, externalMessageId: `turn:${turn.turnKey}`,
    providerMetadata: { channelId: String(conversation.channel), conversationTurn: { turnKey: turn.turnKey, messageIds: turn.messageIds, messageCount: turn.messageIds.length } },
  };
}

export function isTurnQaFree(turn, messagesById) {
  return turn.messageIds.every((id) => !isRealShadowQaMessage(messagesById.get(id)));
}
