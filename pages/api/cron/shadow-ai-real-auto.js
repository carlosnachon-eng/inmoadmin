import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { processNextAutoRealTurn } from "../../../lib/shadow/ai/autoReal";

export const config = { maxDuration: 120 };
const equal = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && timingSafeEqual(x, y); };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ ok: false, error: "Método no permitido." });
  if (!process.env.CRON_SECRET || !equal(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`)) return res.status(401).json({ ok: false, error: "No autorizado." });
  if (process.env.SHADOW_AI_AUTO_REAL_ENABLED !== "true") return res.status(200).json({ ok: true, status: "disabled", processed: [] });
  try {
    const result = await processNextAutoRealTurn(getAdminSupabase(), { env: process.env, inputMode: "auto_real_shadow" });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("[shadow-ai-real-auto]", error?.message || error);
    return res.status(503).json({ ok: false, error: "Auto Shadow detenido de forma segura." });
  }
}
