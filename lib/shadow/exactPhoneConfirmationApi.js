import { confirmCertifiedExactPhoneCohort } from "./exactPhoneConfirmation.js";

export function createExactPhoneConfirmationHandler({ authorize, isSameOrigin, createAdminClient, fetchContact }) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    const actor = await authorize(req);
    if (!actor || actor.active !== true || actor.role_id !== "admin") return res.status(403).json({ ok: false, error: "admin_required" });
    if (!isSameOrigin(req)) return res.status(403).json({ ok: false, error: "invalid_origin" });
    if (process.env.SHADOW_IDENTITY_CONFIRMATION_ENABLED !== "true") return res.status(409).json({ ok: false, error: "identity_confirmation_disabled" });
    try {
      const results = await confirmCertifiedExactPhoneCohort({ admin: createAdminClient(), fetchContact, actor });
      return res.status(200).json({ ok: true, mode: "fail_closed_individual", evaluated: results.length, results });
    } catch (error) {
      console.error("[shadow-exact-phone-confirmation]", error?.message || "confirmation_error");
      return res.status(500).json({ ok: false, error: "identity_confirmation_error" });
    }
  };
}
