import { captureSocialRoute, opaqueSocialRef, socialEligible } from "./routing.js";

const SQLSTATES = new Set(["P0001", "23505", "23503", "23514", "42501", "40001", "40P01", "55P03", "57014", "08006", "PGRST202", "PGRST205"]);
const STAGES = new Set(["transport", "identity", "context", "reference", "capture_rpc"]);
const REASONS = new Set(["capture_failed", "invalid_message_identity", "identity_read_failed", "context_read_failed", "reference_read_failed", "capture_rpc_failed", "context_conflict", "late_message_requires_review", "preexisting_transport_requires_review"]);
export function safeCaptureDiagnostic(error, stage) {
  const reason = error?.message === "social_missing_stable_message_identity" ? "invalid_message_identity"
    : error?.code === "P0001" && error?.message === "social_context_changed_requires_review" ? "context_conflict"
    : ({ identity: "identity_read_failed", context: "context_read_failed", reference: "reference_read_failed", capture_rpc: "capture_rpc_failed" }[stage] || "capture_failed");
  return { sqlstate: SQLSTATES.has(error?.code) ? error.code : null, reason, stage: STAGES.has(stage) ? stage : "transport" };
}

// Only DB classification/CAS may repeat, at most three times, before ANY
// processor or remote effect. Terminal review is never automatically reopened.
export async function captureSocialRouteSafely(db, body, event, options = {}) {
  if (!socialEligible(event, options.env)) return { handled: false };
  let start;
  try { start = await db.rpc("begin_social_capture_v1", { p_event_id: event.eventId }); }
  catch { throw new Error("social_capture_receipt_unavailable"); }
  if (start.error) throw new Error("social_capture_receipt_unavailable"); // pending receipt already durable
  if (start.data?.state !== "pending") return { handled: true, created: false, status: start.data.state };
  const persistedEvent = { ...event, eventOccurredAt: start.data.occurredAt || event.eventOccurredAt };
  let stage = "transport", failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await captureSocialRoute(db, body, persistedEvent, { ...options, onStage: value => { stage = value; } });
    } catch (error) {
      failure = safeCaptureDiagnostic(error, stage);
      if (failure.reason !== "context_conflict") break;
    }
  }
  let result;
  try { result = await db.rpc("fail_social_capture_v1", {
    p_event_id: event.eventId, p_sqlstate: failure.sqlstate, p_reason: failure.reason, p_stage: failure.stage,
  }); } catch { throw new Error("social_capture_review_persistence_unavailable"); }
  if (result.error) throw new Error("social_capture_review_persistence_unavailable");
  return { handled: true, created: false, status: result.data.state };
}

export function socialCaptureReview(row) {
  return {
    eventRef: opaqueSocialRef(row.source_event_id), contactRef: opaqueSocialRef(row.respond_contact_id),
    channelId: ["497382", "497385", "498219", "515318"].includes(row.source_channel_id) ? row.source_channel_id : null,
    routingState: ["pending", "routed", "review_required"].includes(row.routing_state) ? row.routing_state : "pending",
    reason: REASONS.has(row.reason) ? row.reason : null,
    sqlstate: SQLSTATES.has(row.sqlstate) ? row.sqlstate : null,
    stage: STAGES.has(row.stage) ? row.stage : null,
    rpc: ["read_social_route_context_v1", "capture_social_route_v1"].includes(row.rpc_name) ? row.rpc_name : null,
    attempts: Number.isSafeInteger(row.attempts) && row.attempts >= 0 ? row.attempts : null,
    receivedAt: row.first_received_at, lastAttemptAt: row.last_attempt_at, completedAt: row.completed_at,
    transportReceived: true,
    snapshotState: ["pending", "processing", "processed", "failed"].includes(row.transport?.status) ? row.transport.status : "unknown",
    snapshotCompletedAt: row.transport?.processed_at || null,
    // Existing administrative review queue, NOT Respond assignment authority.
    operationalOwner: "Administradores activos — revisión Social",
  };
}
