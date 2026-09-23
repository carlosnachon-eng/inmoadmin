// Copy only these measured 3B fields. Never infer eligibility from action type,
// operational resolution or a human review. Legacy rows remain unmeasured.
export function historicalReplayConversationResult(conversationAction) {
  return {
    requires_human: conversationAction?.requires_human ?? null,
    auto_send_eligible: conversationAction?.auto_send_eligible ?? null,
    blocked_reason: conversationAction?.blocked_reason ?? null,
    conversation_action: conversationAction?.conversation_action ?? null,
  };
}

export function storedHistoricalReplayConversationResult(row) {
  const result = historicalReplayConversationResult(row?.result_safe?.conversationAction);
  // Earlier rows already stored the real action, but not its booleans/blocker.
  return { ...result, conversation_action: result.conversation_action ?? row?.conversation_action ?? null };
}
