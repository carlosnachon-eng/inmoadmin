import { RUN_EXACT_PHONE_PREFLIGHT_REFS, RUN_EXACT_PHONE_PREFLIGHT_VERSION } from "./runExactPhonePreflightRefs.js";

export const sanitizeRunExactPhonePreflightResults = (results) => (results || []).map((result) => ({
  run: result.runRef,
  contact_ref: result.contactRef,
  exact_phone_unique: Boolean(result.exactPhoneUnique),
  one_to_one: Boolean(result.oneToOne),
  conflict: Boolean(result.conflict),
  role: result.role,
  property_relationship_resolved: Boolean(result.propertyRelationshipResolved),
  contract_current: Boolean(result.contractCurrent),
  confirmable: Boolean(result.confirmable),
  blocker: result.blocker,
}));

export function createRunExactPhonePreflightHandler({ authorize, isSameOrigin, evaluate, createAdminClient, fetchContact }) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    const actor = await authorize(req);
    if (!actor || actor.role_id !== "admin") return res.status(403).json({ ok: false, error: "admin_required" });
    if (!isSameOrigin(req)) return res.status(403).json({ ok: false, error: "invalid_origin" });
    if (process.env.SHADOW_IDENTITY_BRIDGE_ENABLED !== "true") return res.status(409).json({ ok: false, error: "identity_bridge_disabled" });
    try {
      const results = sanitizeRunExactPhonePreflightResults(await evaluate(createAdminClient(), { references: RUN_EXACT_PHONE_PREFLIGHT_REFS, fetchContact }));
      return res.status(200).json({ ok: true, cohortVersion: RUN_EXACT_PHONE_PREFLIGHT_VERSION, evaluated: results.length, results });
    } catch (error) {
      console.error("[shadow-run-exact-phone-preflight]", error?.message || "read_only_preflight_error");
      return res.status(500).json({ ok: false, error: "read_only_preflight_error" });
    }
  };
}
