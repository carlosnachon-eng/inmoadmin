import { validateExactPhoneCandidateRefs } from "./exactPhoneReadOnlyEvaluator.js";
import { EXACT_PHONE_VALIDATED_CANDIDATE_REFS, EXACT_PHONE_VALIDATED_COHORT_VERSION } from "./exactPhoneValidatedRefs.js";

export function sanitizeExactPhonePreflightResults(results) {
  return (results || []).map((result) => ({
    reference: result.candidateRef,
    still_confirmable: Boolean(result.confirmable),
    reason: result.reason || null,
    conflict: Boolean(result.conflict),
    current_role: result.role || null,
    property_relationship_current_unambiguous: Boolean(
      result.propertyResolved
      && !result.propertyAmbiguous
      && !result.ambiguous
      && (result.role !== "tenant" || result.contractCurrent),
    ),
  }));
}

export function validateCertifiedExactPhoneCohort(value) {
  const references = validateExactPhoneCandidateRefs(value);
  if (references.length !== EXACT_PHONE_VALIDATED_CANDIDATE_REFS.length) throw new Error("incomplete_exact_phone_candidate_refs");
  const received = new Set(references);
  if (EXACT_PHONE_VALIDATED_CANDIDATE_REFS.some((reference) => !received.has(reference))) throw new Error("incorrect_exact_phone_candidate_refs");
  return [...EXACT_PHONE_VALIDATED_CANDIDATE_REFS];
}

export function createExactPhonePreflightHandler({ authorize, isSameOrigin, evaluate, createAdminClient, fetchContact }) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    const actor = await authorize(req);
    if (!actor) return res.status(403).json({ ok: false, error: "not_authorized" });
    if (actor.role_id !== "admin") return res.status(403).json({ ok: false, error: "admin_required" });
    if (!isSameOrigin(req)) return res.status(403).json({ ok: false, error: "invalid_origin" });
    if (process.env.SHADOW_IDENTITY_BRIDGE_ENABLED !== "true") return res.status(409).json({ ok: false, error: "identity_bridge_disabled" });
    let references;
    try { references = validateCertifiedExactPhoneCohort(req.body?.references); }
    catch { return res.status(400).json({ ok: false, error: "invalid_exact_phone_candidate_refs" }); }
    try {
      const results = await evaluate(createAdminClient(), { references, fetchContact });
      const sanitizedResults = sanitizeExactPhonePreflightResults(results);
      return res.status(200).json({ ok: true, cohortVersion: EXACT_PHONE_VALIDATED_COHORT_VERSION, evaluated: sanitizedResults.length, results: sanitizedResults });
    } catch (error) {
      console.error("[shadow-exact-phone-preflight]", error?.message || "read_only_preflight_error");
      return res.status(500).json({ ok: false, error: "read_only_preflight_error" });
    }
  };
}
