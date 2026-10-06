// Uses authenticated Respond sender evidence in the durable transport ledger.
// Never assignee, snapshot heuristics, a missing journal, or an inactivity TTL.
export async function readHumanAttention(admin, inbound) {
  try {
    const { data, error } = await admin.rpc("read_respond_human_pause_v1", {
      p_contact_id: inbound.respond_contact_id, p_at: inbound.occurred_at,
    });
    if (error || typeof data?.blocked !== "boolean") throw new Error("unverified");
    return data;
  } catch {
    return { blocked: true, reason: "human_attention_unverified" };
  }
}

export async function beginHumanGuardedSalesSend(admin, outboundId) {
  try {
    const { data, error } = await admin.rpc("begin_sales_human_guarded_send_v1", { p_outbound_id: outboundId });
    if (error || typeof data?.allowed !== "boolean") throw new Error("unverified");
    return data;
  } catch {
    // Do not reset the claim: the authorization outcome itself is uncertain.
    // Only a provably unconsumed local marker may become blocked. A marker
    // changed by an ambiguously completed RPC remains consumed, never retried.
    await admin.from("sales_agent_v2_auto_outbound").update({
      status:"blocked",error_code:"human_attention_unverified",completed_at:new Date().toISOString(),
    }).eq("id",outboundId).eq("status","processing").eq("error_code","human_guard_pending");
    return { allowed: false, reason: "human_attention_unverified" };
  }
}

export const pausedSalesResult = (gate, inboundId) => ({
  ok: true, status: "paused", humanPaused: true, policyOnly: true,
  sessionId: "human-review-paused-" + inboundId, output: null, calledTools: [], latencyMs: 0,
  error: { code: gate.reason },
});
