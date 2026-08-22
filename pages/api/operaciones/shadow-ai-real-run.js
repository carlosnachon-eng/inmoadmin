import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth";
import { startRealShadowMessageRun } from "../../../lib/shadow/ai/realRun";

export const config = { maxDuration: 120 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido." });
  try {
    if (!await authorizeShadowAdministrator(req)) return res.status(403).json({ ok: false, error: "No autorizado." });
    const messageId = String(req.body?.messageId || "");
    if (!UUID.test(messageId) || Object.keys(req.body || {}).some((key) => key !== "messageId")) return res.status(400).json({ ok: false, error: "Solicitud inválida." });
    const result = await startRealShadowMessageRun(getAdminSupabase(), messageId);
    const conflict = ["duplicate", "running", "failed_no_retry"].includes(result.status);
    const rejected = !["completed", "blocked", "awaiting_model_round", "duplicate", "running", "failed_no_retry"].includes(result.status);
    return res.status(conflict ? 409 : rejected ? 403 : 200).json({ ok: !conflict && !rejected, ...result });
  } catch (error) {
    console.error("[shadow-ai-real-run]", error?.message || error);
    return res.status(403).json({ ok: false, error: "Ejecución Shadow real bloqueada." });
  }
}
