import { createClient } from "@supabase/supabase-js";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { socialRouteReview, socialRoutingEnabled } from "../../../lib/social/routing.js";

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
    const { data, error } = await createAdmin().from("social_message_routes").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) return res.status(503).json({ error: "social_review_unavailable" });
    return res.status(200).json({ enabled: socialRoutingEnabled(env), routes: (data || []).map(socialRouteReview), readOnly: true });
  };
}
export default createSocialRoutingReviewHandler();
