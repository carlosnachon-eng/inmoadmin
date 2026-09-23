import { condominiumReviewCapabilities, listCondominiumIdentityReview, reviewCondominiumIdentity } from "./condominiumIdentity.js";
import { checkCondominiumResolver, validateCondominiumResolverCheck } from "./condominiumResolverCheck.js";

export function createCondominiumIdentityReviewHandler({ authorize, isSameOrigin, createAdminClient, fetchContact, env = process.env }) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    const actor = await authorize(req);
    if (!actor || actor.active !== true || actor.role_id !== "admin") return res.status(403).json({ ok: false, error: "admin_required" });
    if (!isSameOrigin(req)) return res.status(403).json({ ok: false, error: "invalid_origin" });
    // Only this exact, authenticated SELECT-only action is independent of write gates.
    if (req.body?.action === "condominium_resolver_check") {
      try {
        const ref = validateCondominiumResolverCheck(req.body);
        return res.status(200).json({ ok: true, result: await checkCondominiumResolver(createAdminClient(), ref) });
      } catch (error) {
        const statuses = {
          invalid_condominium_resolver_check: 400, candidate_not_found: 404, candidate_not_confirmed: 409,
          candidate_reference_ambiguous: 409, candidate_scope_mismatch: 409, candidate_lookup_limit: 503,
        };
        const code = Object.hasOwn(statuses, error.message) ? error.message : "condominium_resolver_read_failed";
        return res.status(statuses[code] || 500).json({ ok: false, error: code });
      }
    }
    const capabilities = condominiumReviewCapabilities(env);
    if (!capabilities.prepare && !capabilities.review) return res.status(409).json({ ok: false, error: "condominium_review_disabled" });
    try {
      const admin = createAdminClient();
      if (req.body?.action === "condominium_list") {
        if (Object.keys(req.body).length !== 1) return res.status(400).json({ ok: false, error: "invalid_condominium_review" });
        return res.status(200).json({ ok: true, capabilities, ...await listCondominiumIdentityReview(admin) });
      }
      const result = await reviewCondominiumIdentity({ admin, actor, body: req.body, fetchContact, env });
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      const safe = new Set(["admin_required", "invalid_condominium_review", "condominium_review_disabled", "explicit_ownership_review_required", "invalid_candidate", "invalid_unit", "candidate_scope_mismatch", "invalid_respond_contact_id"]);
      return res.status(400).json({ ok: false, error: safe.has(error.message) ? error.message : "condominium_review_failed" });
    }
  };
}
