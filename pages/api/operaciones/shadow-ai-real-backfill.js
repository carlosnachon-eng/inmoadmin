import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth";
import { AUTO_REAL_LOOKBACK_DAYS_MAX, estimateAutoRealVolume, loadAutoRealTurns, processNextAutoRealTurn } from "../../../lib/shadow/ai/autoReal";

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ ok: false, error: "Método no permitido." });
  try {
    if (!await authorizeShadowAdministrator(req)) return res.status(403).json({ ok: false, error: "No autorizado." });
    const lookbackDays = Number(req.method === "GET" ? req.query?.lookbackDays || AUTO_REAL_LOOKBACK_DAYS_MAX : req.body?.lookbackDays || AUTO_REAL_LOOKBACK_DAYS_MAX);
    if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > AUTO_REAL_LOOKBACK_DAYS_MAX) return res.status(400).json({ ok: false, error: "Ventana inválida." });
    if (req.method === "POST" && Object.keys(req.body || {}).some((key) => key !== "lookbackDays")) return res.status(400).json({ ok: false, error: "Solicitud inválida." });
    const admin = getAdminSupabase();
    if (req.method === "GET") {
      const loaded = await loadAutoRealTurns(admin, { lookbackDays, env: process.env });
      const estimate = estimateAutoRealVolume(loaded.turns);
      return res.status(200).json({ ok: true, lookbackDays, totalTurns: loaded.turns.length, pending: estimate.pendingTurns, completed: loaded.turns.filter((item)=>item.disposition==='skip_completed').length, running: loaded.turns.filter((item)=>item.disposition==='block_running').length, failed: loaded.turns.filter((item)=>item.disposition==='report_failed_no_retry').length, estimate });
    }
    const result = await processNextAutoRealTurn(admin, { env: process.env, lookbackDays, inputMode: "backfill_real_shadow" });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("[shadow-ai-real-backfill]", error?.message || error);
    return res.status(403).json({ ok: false, error: "Backfill Shadow bloqueado." });
  }
}
