import { createHash } from "node:crypto";
import { REAL_SHADOW_ADMIN_CHANNEL_ID, isRealShadowQaMessage, realShadowMessageEligibility } from "./realMessage.js";
import { priorConversationActor } from "./actorRoleGuards.js";

export const REAL_SHADOW_TURN_GAP_MS = 5 * 60 * 1000;
export const REAL_SHADOW_TURN_SETTLE_MS = 2 * 60 * 1000;
export const REAL_SHADOW_MEDIA_SETTLE_MAX_MS = 8 * 60 * 1000;
export const REAL_SHADOW_CONTEXT_MAX_MESSAGES = 8;
export const REAL_SHADOW_CONTEXT_MAX_CHARS = 4000;

const time = (value) => new Date(value).getTime();
const turnHash = (conversationId, messageIds) => createHash("sha256").update(`${conversationId}:${messageIds.join(":")}`).digest("hex");

const safeInterpretation = (value) => value?.interpretation_status === "completed" ? {
  interpretationStatus:"completed",category:String(value.category||""),summary:String(value.summary||"").slice(0,240),
  extractedFields:value.extracted_fields&&typeof value.extracted_fields==="object"?value.extracted_fields:{},
  confidence:Number(value.confidence||0),requiresHumanReview:value.requires_human_review===true,reviewReason:value.review_reason?String(value.review_reason).slice(0,160):null,
} : null;

export function buildRealShadowConversationTurns({ messages = [], conversations = [], mediaInterpretations = [], mediaRetrievals = [], env = process.env, now = Date.now(), gapMs = REAL_SHADOW_TURN_GAP_MS, settleMs = REAL_SHADOW_TURN_SETTLE_MS, mediaSettleMaxMs = REAL_SHADOW_MEDIA_SETTLE_MAX_MS }) {
  const interpretationByMessage=new Map(mediaInterpretations.filter((item)=>item.status==="completed"&&item.result_safe?.interpretation_status==="completed").map((item)=>[item.external_message_id,safeInterpretation(item.result_safe)]));
  const retrievalByMessage = new Map(mediaRetrievals.map((item) => [item.external_message_id, item]));
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
    const attachments = current.messages.flatMap((message) => (Array.isArray(message.attachment_metadata) ? message.attachment_metadata : [])
      .map((item) => ({ type: String(item?.type || "file"), mimeType: item?.mimeType ? String(item.mimeType) : null, sourceMessageId: message.external_message_id, interpretation:interpretationByMessage.get(message.external_message_id)||null })))
      .slice(0, 10);
    const allowed = attachments.filter((item) => ["image/jpeg", "image/png", "image/webp"].includes(String(item.mimeType || "").toLowerCase()));
    const terminal = new Set(["rejected", "failed", "expired"]);
    const interpretedCount = allowed.filter((item) => item.interpretation?.interpretationStatus === "completed").length;
    const terminalCount = allowed.filter((item) => terminal.has(retrievalByMessage.get(item.sourceMessageId)?.status)).length;
    const pendingCount = Math.max(0, allowed.length - interpretedCount - terminalCount);
    const waitDeadlineMs = time(last.occurred_at) + mediaSettleMaxMs;
    const mediaSettlement = {
      status: pendingCount === 0 ? "ready_or_terminal" : now < waitDeadlineMs ? "waiting" : "deadline_reached_with_pending",
      allowed_count: allowed.length, interpreted_count: interpretedCount, terminal_count: terminalCount,
      not_used_count: pendingCount, wait_deadline_at: new Date(waitDeadlineMs).toISOString(),
      ...(pendingCount > 0 && now >= waitDeadlineMs ? { snapshot_frozen_at: new Date(now).toISOString() } : {}),
    };
    turns.push({
      turnKey: turnHash(current.conversationId, ids), conversationId: current.conversationId,
      messageIds: ids, anchorMessageId: last.id, firstInboundAt: current.messages[0].occurred_at,
      lastInboundAt: last.occurred_at, sanitizedText: current.messages.map((item) => item.sanitized_text).join("\n"),
      humanResponseId, closedReason: reason, priorContextMessages: current.priorContextMessages || [],
      attachmentContext: { present: attachments.length > 0, interpreted: attachments.some((item)=>item.interpretation?.interpretationStatus==="completed"), items: attachments },
      mediaSettlement,
    });
  };
  for (const [conversationId, items] of grouped) {
    const conversation = conversationsById.get(conversationId); let current = null; const history = [];
    const priorContext = () => {
      let chars = 0; const bounded = [];
      for (const item of history.slice(-REAL_SHADOW_CONTEXT_MAX_MESSAGES).reverse()) {
        const text = String(item.sanitizedText || "").slice(0, 1200);
        if (!text || chars + text.length > REAL_SHADOW_CONTEXT_MAX_CHARS) continue;
        bounded.unshift({ direction: item.direction, occurredAt: item.occurredAt, sanitizedText: text }); chars += text.length;
      }
      return bounded;
    };
    for (const message of [...items].sort((a, b) => time(a.occurred_at) - time(b.occurred_at) || String(a.id).localeCompare(String(b.id)))) {
      if (message.direction === "inbound") {
        const eligibility = realShadowMessageEligibility({ message, conversation, env });
        if (!eligibility.allowed) {
          if (current) for (const item of current.messages) history.push({ direction: "inbound", occurredAt: item.occurred_at, sanitizedText: item.sanitized_text });
          close(current, "excluded_message"); current = null; continue;
        }
        if (current && time(message.occurred_at) - time(current.messages.at(-1).occurred_at) > gapMs) {
          const inbound = [...current.messages]; close(current, "inbound_gap");
          for (const item of inbound) history.push({ direction: "inbound", occurredAt: item.occurred_at, sanitizedText: item.sanitized_text }); current = null;
        }
        current ||= { conversationId, messages: [], priorContextMessages: priorContext() };
        current.messages.push(message);
      } else if (["outbound_ai_inmoadmin", "outbound_respond_ai", "outbound_unknown"].includes(message.direction)) {
        history.push({ direction: message.direction, occurredAt: message.occurred_at, sanitizedText: message.sanitized_text });
      } else if (current && message.direction === "outbound_human") {
        const inbound = [...current.messages]; close(current, "human_response", message.id);
        for (const item of inbound) history.push({ direction: "inbound", occurredAt: item.occurred_at, sanitizedText: item.sanitized_text });
        if (!isRealShadowQaMessage(message)) history.push({ direction: "outbound_human", occurredAt: message.occurred_at, sanitizedText: message.sanitized_text });
        current = null;
      } else if (current) {
        const inbound = [...current.messages]; close(current, "direction_change");
        for (const item of inbound) history.push({ direction: "inbound", occurredAt: item.occurred_at, sanitizedText: item.sanitized_text }); current = null;
      } else if (message.direction === "outbound_human" && !isRealShadowQaMessage(message)) {
        history.push({ direction: "outbound_human", occurredAt: message.occurred_at, sanitizedText: message.sanitized_text });
      }
    }
    if (current && now - time(current.messages.at(-1).occurred_at) >= settleMs) close(current, "settled");
  }
  return turns.sort((a, b) => time(a.lastInboundAt) - time(b.lastInboundAt));
}

export function realShadowTurnEnvelope(turn, conversation, env = process.env) {
  return {
    provider: "respond_admin", direction: "inbound", sanitizedText: turn.sanitizedText,
    occurredAt: turn.lastInboundAt, externalMessageId: `turn:${turn.turnKey}`,
    providerMetadata: {
      channelId: String(conversation.channel),
      ...(env.SHADOW_IDENTITY_BRIDGE_ENABLED === "true" ? { respondContactId: String(conversation.respond_contact_id || "") } : {}),
      priorConversation: (turn.priorContextMessages || []).map(({ direction, sanitizedText }) => ({ direction, actor: priorConversationActor(direction), sanitizedText })),
      conversationTurn: { turnKey: turn.turnKey, messageIds: turn.messageIds, messageCount: turn.messageIds.length },
      attachmentContext: turn.attachmentContext ? {
        present: turn.attachmentContext.present, interpreted: turn.attachmentContext.interpreted,
        items: (turn.attachmentContext.items || []).map(({ sourceMessageId: _sourceMessageId, ...item }) => item),
      } : { present: false, interpreted: false, items: [] },
      mediaSettlement: turn.mediaSettlement || null,
    },
  };
}

export function isTurnQaFree(turn, messagesById) {
  return turn.messageIds.every((id) => !isRealShadowQaMessage(messagesById.get(id)));
}
