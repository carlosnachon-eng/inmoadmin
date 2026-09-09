import { createHash } from "node:crypto";
import { contactPhoneFromRespondPayload } from "./identityBridge.js";
import { exactPhoneCandidateRef } from "./exactPhoneReadOnlyEvaluator.js";
import { EXACT_PHONE_VALIDATED_CANDIDATE_REFS } from "./exactPhoneValidatedRefs.js";

export const EXACT_PHONE_CONFIRMATION_EVIDENCE_VERSION = "exact_phone_unique_confirmation_v2";

const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

async function loadConfirmationCandidates(admin) {
  const { data, error } = await admin.from("respond_identity_links")
    .select("id,respond_contact_id,client_identity_id,link_status,link_source,confidence,reason_code")
    .in("link_status", ["candidate", "confirmed"]).eq("link_source", "exact_phone_unique")
    .eq("reason_code", "exact_full_phone_unique_candidate").eq("confidence", 0.95).limit(200);
  if (error) throw error;
  const byRef = new Map();
  for (const row of data || []) {
    const ref = exactPhoneCandidateRef(row.id);
    if (!EXACT_PHONE_VALIDATED_CANDIDATE_REFS.includes(ref)) continue;
    byRef.set(ref, byRef.has(ref) ? null : row);
  }
  return EXACT_PHONE_VALIDATED_CANDIDATE_REFS.map((candidateRef) => ({ candidateRef, link: byRef.get(candidateRef) || null }));
}

export async function confirmCertifiedExactPhoneCohort({ admin, fetchContact, actor, effectiveAt = new Date().toISOString(), loadCandidates = loadConfirmationCandidates }) {
  if (!actor?.id || actor.active !== true || actor.role_id !== "admin") throw new Error("actor_not_authorized");
  const candidates = await loadCandidates(admin);
  const results = [];
  for (const { candidateRef, link } of candidates) {
    if (!link) {
      results.push({ reference: candidateRef, status: "rejected", reason: "candidate_not_found" });
      continue;
    }
    let observedPhoneDigest = null;
    let serverRejectionReason = null;
    try {
      const contact = await fetchContact(link.respond_contact_id);
      if (!contact || String(contact.id || "") !== String(link.respond_contact_id)) serverRejectionReason = "respond_contact_not_found";
      else {
        const normalizedPhone = contactPhoneFromRespondPayload({ contact });
        if (!normalizedPhone) serverRejectionReason = "respond_phone_unusable";
        else observedPhoneDigest = sha256(normalizedPhone);
      }
    } catch (error) {
      serverRejectionReason = Number(error?.public?.status) === 404 ? "respond_contact_not_found" : "respond_read_error";
    }
    const { data, error } = await admin.rpc("confirm_exact_phone_respond_identity_link", {
      p_candidate_ref: candidateRef,
      p_link_id: link.id,
      p_respond_contact_id: link.respond_contact_id,
      p_observed_phone_digest: observedPhoneDigest,
      p_effective_at: effectiveAt,
      p_evidence_version: EXACT_PHONE_CONFIRMATION_EVIDENCE_VERSION,
      p_server_rejection_reason: serverRejectionReason,
      p_actor_profile_id: actor.id,
    });
    if (error) results.push({ reference: candidateRef, status: "error", reason: "confirmation_rpc_error" });
    else {
      const row = Array.isArray(data) ? data[0] : data;
      results.push({ reference: candidateRef, status: row?.result_status || "error", reason: row?.result_reason || null });
    }
  }
  return results;
}
