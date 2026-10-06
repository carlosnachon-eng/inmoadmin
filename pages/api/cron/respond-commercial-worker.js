import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { processCommercialQueueOne } from "../../../lib/social/commercialQueue.js";
import { recoverCommercialExecutionOne } from "../../../lib/social/commercialExecution.js";
import { processSalesInboundById } from "../../../lib/agentsV2/processSalesInbound";
import { processOwnerInboundById } from "../../../lib/agentsV2/processOwnerInbound";
import { processLegalInboundById } from "../../../lib/agentsV2/processLegalInbound";

// At most 40s of capture work + one existing lane's 120s budget + margin.
// Do not start another model after the first lane attempt in this invocation.
export const config = { maxDuration: 180 };
const processors = { SALES: processSalesInboundById, OWNER: processOwnerInboundById, LEGAL: processLegalInboundById };
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
    const recovered = await recoverCommercialExecutionOne(db, { processors });
    if (recovered.laneAttempted) return res.status(200).json({ ok: true, counts: { executionRecovery: 1 } });
    for (let n = 0; n < 20 && Date.now() < until; n++) {
      const { status, laneAttempted, laneStatus } = await processCommercialQueueOne(db, { processors });
      counts[status] = (counts[status] || 0) + 1;
      if (laneAttempted) {
        counts["lane_" + laneStatus] = (counts["lane_" + laneStatus] || 0) + 1;
        break;
      }
      if (["idle", "disabled"].includes(status)) break;
    }
    return res.status(200).json({ ok: true, counts });
  } catch {
    return res.status(503).json({ ok: false, error: "commercial_worker_unavailable" });
  }
}
