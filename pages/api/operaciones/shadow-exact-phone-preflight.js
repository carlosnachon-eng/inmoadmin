import { createClient } from "@supabase/supabase-js";
import { fetchRespondContact } from "../../../lib/ejecutivo/respondSync.js";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { evaluateExactPhoneCohortReadOnly, validateExactPhoneCandidateRefs } from "../../../lib/shadow/exactPhoneReadOnlyEvaluator.js";
import { EXACT_PHONE_VALIDATED_COHORT_VERSION } from "../../../lib/shadow/exactPhoneValidatedRefs.js";
import { sameOriginAdminRequest } from "../../../lib/shadow/identityBootstrap.js";

const adminClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const actor = await authorizeShadowAdministrator(req);
  if (!actor) return res.status(403).json({ ok: false, error: "not_authorized" });
  if (!sameOriginAdminRequest(req)) return res.status(403).json({ ok: false, error: "invalid_origin" });
  if (process.env.SHADOW_IDENTITY_BRIDGE_ENABLED !== "true") return res.status(409).json({ ok: false, error: "identity_bridge_disabled" });
  let references;
  try { references = validateExactPhoneCandidateRefs(req.body?.references); }
  catch { return res.status(400).json({ ok: false, error: "invalid_exact_phone_candidate_refs" }); }
  try {
    const results = await evaluateExactPhoneCohortReadOnly(adminClient(), { references, fetchContact: fetchRespondContact });
    return res.status(200).json({ ok: true, cohortVersion: EXACT_PHONE_VALIDATED_COHORT_VERSION, evaluated: results.length, results });
  } catch (error) {
    console.error("[shadow-exact-phone-preflight]", error?.message || "read_only_preflight_error");
    return res.status(500).json({ ok: false, error: "read_only_preflight_error" });
  }
}
