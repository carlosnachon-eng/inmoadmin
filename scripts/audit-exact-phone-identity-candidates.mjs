import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { evaluateExactPhoneIdentityCandidate } from "../lib/shadow/identityBridge.js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const respondToken = process.env.RESPOND_IO_TOKEN || process.env.RESPOND_IO_API_TOKEN;
if (!url || !key || !respondToken) throw new Error("audit_environment_missing");
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const fetchRespondContact = async (respondContactId) => {
  const response = await fetch(`https://api.respond.io/v2/contact/id:${encodeURIComponent(String(respondContactId))}`, {
    headers: { Authorization: `Bearer ${respondToken}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`respond_contact_read_failed:${response.status}`);
  const body = await response.json();
  const contact = body?.contact || body?.item || body?.data || body;
  if (!contact?.id) throw new Error("respond_contact_invalid");
  return contact;
};
const { data: candidates, error } = await admin.from("respond_identity_links")
  .select("id,respond_contact_id,created_at")
  .eq("link_status", "candidate").eq("link_source", "exact_phone_unique")
  .eq("reason_code", "exact_full_phone_unique_candidate").eq("confidence", 0.95)
  .order("created_at", { ascending: true }).limit(10);
if (error) throw error;

const results = [];
for (const candidate of candidates || []) {
  const currentContact = await fetchRespondContact(candidate.respond_contact_id);
  const assessment = await evaluateExactPhoneIdentityCandidate(admin, {
    linkId: candidate.id, respondContactId: candidate.respond_contact_id, currentContact, effectiveAt: new Date().toISOString(),
  });
  results.push({
    candidateRef: createHash("sha256").update(candidate.id).digest("hex").slice(0, 12),
    confirmable: assessment.confirmable, reason: assessment.reason,
    role: assessment.role || null, hasProperty: Boolean(assessment.propertyId), hasContract: Boolean(assessment.contractId),
    evidenceVersion: assessment.evidenceVersion || null,
  });
}
const reasons = results.reduce((acc, row) => ({ ...acc, [row.reason || "confirmable"]: (acc[row.reason || "confirmable"] || 0) + 1 }), {});
console.log(JSON.stringify({ evaluated: results.length, confirmable: results.filter((row) => row.confirmable).length, blocked: results.filter((row) => !row.confirmable).length, reasons, results }, null, 2));
