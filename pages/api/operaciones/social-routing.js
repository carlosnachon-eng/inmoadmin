import { createClient } from "@supabase/supabase-js";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { socialRouteReview, socialRoutingEnabled } from "../../../lib/social/routing.js";
import { socialCaptureReview } from "../../../lib/social/captureReceipt.js";
import { respondInboxLink } from "../../../lib/ejecutivo/workCenter.js";

export function createSocialRoutingReviewHandler({ authorize = authorizeShadowAdministrator,
  createAdmin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }), env = process.env } = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
    const actor = await authorize(req);
    if (!actor?.active || actor.role_id !== "admin") return res.status(403).json({ error: "admin_required" });
    // Read-only bearer-authenticated endpoint, no CORS; reject explicit foreign Origins.
    if (req.headers.origin) {
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const protocol = req.headers["x-forwarded-proto"] || (req.socket?.encrypted ? "https" : "http");
      try { if (new URL(req.headers.origin).origin !== `${protocol}://${host}`) return res.status(403).json({ error: "origin_not_allowed" }); }
      catch { return res.status(403).json({ error: "origin_not_allowed" }); }
    }
    const db = createAdmin();
    const page = Number(req.query?.capturePage || 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 1000000) return res.status(400).json({ error: "invalid_review_page" });
    const [{ data, error }, receipts] = await Promise.all([
      db.from("social_message_routes").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("social_capture_receipts").select("*,transport:gv_respond_webhook_events(status,processed_at)")
        .in("routing_state", ["pending", "review_required"])
        .order("first_received_at", { ascending: true }).order("source_event_id", { ascending: true }).range(page * 100, page * 100 + 100),
    ]);
    if (error || receipts.error) return res.status(503).json({ error: "social_review_unavailable" });
    const inbox = row => /^\d{1,20}$/.test(row.respond_contact_id || "") ? respondInboxLink(row.respond_contact_id) : null;
    return res.status(200).json({ enabled: socialRoutingEnabled(env),
      routes: (data || []).map(row => ({ ...socialRouteReview(row), inboxUrl: row.inbound_id ? null : inbox(row) })),
      captureReviews: (receipts.data || []).slice(0,100).map(row => ({ ...socialCaptureReview(row), inboxUrl: inbox(row) })),
      capturePage: page, captureHasMore: receipts.data?.length > 100, readOnly: true });
  };
}
export default createSocialRoutingReviewHandler();
