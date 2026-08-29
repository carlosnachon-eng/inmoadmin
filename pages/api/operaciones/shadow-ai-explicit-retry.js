import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter.js";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { sameOriginAdminRequest } from "../../../lib/shadow/identityBootstrap.js";
import { EXPLICIT_RETRY_REASON, executeExplicitRetry, listExplicitRetryCandidates } from "../../../lib/shadow/ai/explicitRetry.js";

export const config = { maxDuration: 120 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    const actor = await authorizeShadowAdministrator(req);
    if (!actor) return res.status(403).json({ ok: false, error: "not_authorized" });
    const admin = getAdminSupabase();
    if (req.method === "GET") return res.status(200).json({ ok: true, candidates: await listExplicitRetryCandidates(admin) });
    if (!sameOriginAdminRequest(req)) return res.status(403).json({ ok: false, error: "invalid_origin" });
    const parentRunId = String(req.body?.parentRunId || "");
    const authorization = String(req.body?.authorization || "");
    if (!UUID.test(parentRunId) || authorization !== EXPLICIT_RETRY_REASON || Object.keys(req.body || {}).some((key) => !["parentRunId", "authorization"].includes(key))) return res.status(400).json({ ok: false, error: "invalid_request" });
    const result = await executeExplicitRetry(admin, { parentRunId, actorProfileId: actor.id, authorization });
    return res.status(result.eligible && result.runId ? 200 : 409).json({ ok: Boolean(result.eligible && result.runId), ...result });
  } catch (error) {
    console.error("[shadow-ai-explicit-retry]", safeLog(error));
    return res.status(403).json({ ok: false, error: "explicit_retry_blocked" });
  }
}

const safeLog = (error) => String(error?.message || "explicit_retry_error").replace(/[^a-z0-9_:-]/gi, "_").slice(0, 80);
