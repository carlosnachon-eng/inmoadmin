import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { fetchRespondContact } from "../../../lib/ejecutivo/respondSync.js";
import { evaluateExactPhoneIdentityCandidate } from "../../../lib/shadow/identityBridge.js";

const EXPECTED_BRANCH = "codex/fase-3c-canonical-identity-resolution";
const disabled = (name) => String(process.env[name] || "false").toLowerCase() !== "true";
const ref = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== EXPECTED_BRANCH) {
    return res.status(404).json({ ok: false, error: "preview_only" });
  }
  const guarded = ["SHADOW_ADMIN_OUTBOUND_ENABLED", "SHADOW_OUTBOUND_ENABLED", "SHADOW_ADMIN_WORK_R1_ENABLED", "SHADOW_IDENTITY_LINK_REVIEW_WRITE_ENABLED"].every(disabled);
  if (!guarded || process.env.SHADOW_ADMIN_OUTBOUND_CANARY_ID) return res.status(409).json({ ok: false, error: "write_capability_not_closed" });
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const admin = createClient(url.toString(), process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: candidates, error } = await admin.from("respond_identity_links")
      .select("id,respond_contact_id,created_at").eq("link_status", "candidate")
      .eq("link_source", "exact_phone_unique").eq("reason_code", "exact_full_phone_unique_candidate")
      .eq("confidence", 0.95).order("created_at", { ascending: true }).limit(10);
    if (error) throw error;
    const results = [];
    for (const candidate of candidates || []) {
      const currentContact = await fetchRespondContact(candidate.respond_contact_id);
      const assessment = await evaluateExactPhoneIdentityCandidate(admin, {
        linkId: candidate.id, respondContactId: candidate.respond_contact_id,
        currentContact, effectiveAt: new Date().toISOString(),
      });
      results.push({ candidateRef: ref(candidate.id), confirmable: assessment.confirmable, reason: assessment.reason,
        role: assessment.role || null, hasProperty: Boolean(assessment.propertyId), hasContract: Boolean(assessment.contractId),
        evidenceVersion: assessment.evidenceVersion || null });
    }
    return res.status(200).json({ ok: true, dryRun: true, projectRef: url.hostname.split(".")[0],
      gates: { adminOutbound: false, globalOutbound: false, r1: false, identityWrite: false, canaryArmed: false },
      evaluated: results.length, confirmable: results.filter((row) => row.confirmable).length,
      blocked: results.filter((row) => !row.confirmable).length, results });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error?.message || "dry_run_failed").slice(0, 120) });
  }
}
