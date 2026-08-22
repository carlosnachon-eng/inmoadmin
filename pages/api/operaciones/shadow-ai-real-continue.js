import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth";
import { continueRealShadowMessageRun } from "../../../lib/shadow/ai/realRun";

export const config = { maxDuration: 120 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido." });
  try {
    if (!await authorizeShadowAdministrator(req)) return res.status(403).json({ ok: false, error: "No autorizado." });
    const runId = String(req.body?.runId || "");
    if (!UUID.test(runId) || Object.keys(req.body || {}).some((key) => key !== "runId")) return res.status(400).json({ ok: false, error: "Solicitud inválida." });
    const result = await continueRealShadowMessageRun(getAdminSupabase(), runId);
    const ok = ["completed", "blocked", "awaiting_model_round"].includes(result.status);
    return res.status(ok ? 200 : 409).json({ ok, ...result });
  } catch (error) {
    console.error("[shadow-ai-real-continue]", error?.message || error);
    return res.status(403).json({ ok: false, error: "Continuación Shadow real bloqueada." });
  }
}
