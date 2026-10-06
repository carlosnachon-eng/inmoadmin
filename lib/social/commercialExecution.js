import { createHash } from "node:crypto";
import { socialRoutingEnabled } from "./routing.js";

// One journal for all entry points (immediate worker and existing lane crons).
// Never interpret a thrown network/model error as a confirmed model failure.
export async function withCommercialExecution(db, lane, id, env, run) {
  const claim = await db.rpc("claim_respond_execution_v1", {
    p_lane: lane, p_inbound: id, p_enabled: socialRoutingEnabled(env),
  });
  if (claim.error || typeof claim.data?.managed !== "boolean") throw new Error("execution_claim_unverified");
  if (!claim.data.managed) return run(null); // Not a new #170 job: unchanged lane behavior.
  if (!claim.data.authorized) return { status: claim.data.state };
  let stopped = false;
  const step = async (action, sessionId = null) => {
    const { data, error } = await db.rpc("step_respond_execution_v1", {
      p_inbound: id, p_token: claim.data.token, p_action: action,
      p_session_ref: sessionId ? createHash("sha256").update(String(sessionId)).digest("hex") : null,
    });
    if (error || typeof data?.allowed !== "boolean") throw new Error("execution_step_unverified");
    if (!data.allowed) {
      stopped = true;
      const halt = new Error("execution_halted"); halt.executionState = data.state; throw halt;
    }
  };
  const execution = { inbound: claim.data.inbound, step,
    async modelResult(session) {
      // Explicit provider terminal state, BEFORE publishing a run/output. Tools
      // permanently consume the retry boundary, even if they were read-only.
      if (session?.status === "failed" && session.id) await step("model_failed", session.id);
    },
  };
  try {
    const result = await run(execution);
    if (result?.status === "failed" || result?.runStatus === "failed" || result?.outbound?.status === "error"
      || result?.outbound?.outboundStatus === "failed") await step("error");
    await step("complete");
    return result;
  } catch (error) {
    if (stopped) return { status: error.executionState || "review_required" };
    // A lost reply to a checkpoint is uncertain. DB phase/token decides; never
    // release an effect reservation or infer that dispatch was cancelled.
    try { await step("error"); } catch (halt) {
      if (halt.executionState) return { status: halt.executionState };
    }
    throw new Error("commercial_execution_requires_review");
  }
}

export async function recoverCommercialExecutionOne(db, { env = process.env, processors } = {}) {
  if (!socialRoutingEnabled(env)) return { status: "disabled" };
  // Selection is a hint only. The same RPC/row lock authorizes every consumer.
  const { data: row, error } = await db.rpc("next_respond_execution_v1", {});
  if (error) throw new Error("execution_recovery_unavailable");
  if (!row) return { status: "idle" };
  const processor = processors?.[row.lane];
  if (!processor) throw new Error("execution_lane_unavailable");
  const result = await processor(db, row.inbound_id, { env });
  return { status: result.status, laneAttempted: true };
}
