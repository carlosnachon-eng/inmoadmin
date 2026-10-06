import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { processCommercialQueueOne } from "../../../lib/social/commercialQueue.js";

export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ ok: false });
  const actual = Buffer.from(String(req.headers.authorization || ""));
  const expected = Buffer.from("Bearer " + (process.env.CRON_SECRET || ""));
  if (!process.env.CRON_SECRET || actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return res.status(401).json({ ok: false });
  const db = getAdminSupabase(), until = Date.now() + 40000;
  const counts = {};
  try {
    for (let n = 0; n < 20 && Date.now() < until; n++) {
      const { status } = await processCommercialQueueOne(db);
      counts[status] = (counts[status] || 0) + 1;
      if (["idle", "disabled"].includes(status)) break;
    }
    return res.status(200).json({ ok: true, counts });
  } catch {
    return res.status(503).json({ ok: false, error: "commercial_worker_unavailable" });
  }
}
