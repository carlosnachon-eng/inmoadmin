import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth";
import { authorizeManualRealMessage } from "../../../lib/shadow/ai/manualAuthorization";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido." });
  try {
    const actor = await authorizeShadowAdministrator(req);
    if (!actor) return res.status(403).json({ ok: false, error: "No autorizado." });
    const messageId = String(req.body?.messageId || "");
    if (!UUID.test(messageId) || Object.keys(req.body || {}).some((key) => key !== "messageId")) return res.status(400).json({ ok: false, error: "Solicitud inválida." });
    const result = await authorizeManualRealMessage(getAdminSupabase(), messageId, actor.id);
    const ok = result.status === "authorized";
    return res.status(ok ? 200 : 409).json({ ok, ...result });
  } catch (error) {
    console.error("[shadow-ai-real-authorize]", error?.message || error);
    return res.status(403).json({ ok: false, error: "Autorización Shadow bloqueada." });
  }
}
