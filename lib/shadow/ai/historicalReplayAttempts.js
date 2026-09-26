export const REPLAY_ATTEMPTS_TABLE = "shadow_historical_replay_attempts";
export const REPLAY_CASES_TABLE = "shadow_historical_replay_cases";
export const REPLAY_RETRY_AUTHORIZATION = "explicit_admin_retry";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const isUuid = (value) => typeof value === "string" && UUID.test(value);
const RETRY_ERRORS = new Set(["admin_required", "replay_case_not_found", "replay_parent_not_found", "replay_retry_requires_error", "replay_retry_not_latest"]);
export const isReplayRetryAdmin = (actor) => actor?.active === true && actor?.role_id === "admin";

export function validReplayRetryRequest(body) {
  return body?.authorization === REPLAY_RETRY_AUTHORIZATION && isUuid(body.caseId)
    && (body.parentAttemptId == null || isUuid(body.parentAttemptId))
    && Object.keys(body).every((key) => ["action", "caseId", "parentAttemptId", "authorization"].includes(key));
}

export async function prepareHistoricalReplayRetry(admin, actor, body) {
  const { data, error } = await admin.rpc("prepare_historical_replay_retry", {
    p_case_id: body.caseId, p_parent_attempt_id: body.parentAttemptId || null, p_actor_id: actor.id,
  });
  if (error) return { status: error.message === "admin_required" ? 403 : 409,
    body: { ok: false, error: RETRY_ERRORS.has(error.message) ? error.message : "replay_retry_creation_failed" } };
  // No free-form DB exception, parent result, or provider activity in this path.
  if (!data || !isUuid(data.id) || typeof data.attemptRef !== "string" || !/^[a-f0-9]{32}$/.test(data.attemptRef)
    || !Number.isInteger(data.attemptNumber) || data.attemptNumber < 2 || typeof data.created !== "boolean"
    || !["pending", "running", "completed", "error"].includes(data.status)) {
    return { status: 409, body: { ok: false, error: "replay_retry_creation_uncertain" } };
  }
  return { status: data.created ? 201 : 200, body: { ok: true, attemptId: data.id, attemptRef: data.attemptRef,
    attemptNumber: data.attemptNumber, status: data.status, created: data.created } };
}

export async function loadReplayExecutionTarget(admin, body) {
  if (!body.attemptId) {
    const { data, error } = await admin.from(REPLAY_CASES_TABLE).select("*").eq("id", String(body.caseId || "")).eq("status", "pending").maybeSingle();
    if (error) throw error;
    return data ? { row: data, table: REPLAY_CASES_TABLE, id: data.id } : null;
  }
  if (!isUuid(body.attemptId) || !isUuid(body.caseId)) return null;
  const { data: attempt, error } = await admin.from(REPLAY_ATTEMPTS_TABLE).select("*").eq("id", body.attemptId).eq("case_id", body.caseId).eq("status", "pending").maybeSingle();
  if (error) throw error;
  if (!attempt) return null;
  const { data: original, error: originalError } = await admin.from(REPLAY_CASES_TABLE).select("*").eq("id", attempt.case_id).eq("status", "error").maybeSingle();
  if (originalError) throw originalError;
  // Only snapshot/grounding are consumed from original. Outcomes always go to child.
  return original ? { row: original, table: REPLAY_ATTEMPTS_TABLE, id: attempt.id } : null;
}
