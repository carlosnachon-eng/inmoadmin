import { createHash } from "node:crypto";
import { contactPhoneFromRespondPayload, validateRespondContactId } from "./identityBridge.js";
import { EXACT_PHONE_VALIDATED_CANDIDATE_REFS } from "./exactPhoneValidatedRefs.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_REF = /^[a-f0-9]{12}$/;
const ACTIVE_ROLE = new Set(["tenant", "owner"]);
const TERMINAL_CONTRACT = new Set(["vencido", "expired", "cancelado", "cancelled", "terminado", "ended"]);
const INACTIVE_PROPERTY = new Set(["inactive", "inactiva", "inactivo", "archived", "archivada", "disabled", "deshabilitada"]);

export const exactPhoneCandidateRef = (linkId) => createHash("sha256").update(String(linkId || "")).digest("hex").slice(0, 12);

export function validateExactPhoneCandidateRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > EXACT_PHONE_VALIDATED_CANDIDATE_REFS.length) throw new Error("invalid_exact_phone_candidate_refs");
  const refs = value.map((item) => String(item || "").trim().toLowerCase());
  const allowed = new Set(EXACT_PHONE_VALIDATED_CANDIDATE_REFS);
  if (refs.some((item) => !OPAQUE_REF.test(item) || !allowed.has(item)) || new Set(refs).size !== refs.length) throw new Error("invalid_exact_phone_candidate_refs");
  return refs;
}

const sha256Hex = async (value) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const isoDay = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
};

const contractIsCurrent = (row, effectiveAt) => {
  const effective = isoDay(effectiveAt);
  const start = isoDay(row?.start_date);
  const end = isoDay(row?.end_date);
  if (!effective || (start && start > effective) || (end && end < effective)) return false;
  return !TERMINAL_CONTRACT.has(String(row?.status || "").toLowerCase());
};

const propertyIsCurrent = (row) => !INACTIVE_PROPERTY.has(String(row?.status || "").toLowerCase());
const rejected = (candidateRef, reason, extra = {}) => ({
  candidateRef, contactExists: extra.contactExists ?? true, phoneDigestMatches: extra.phoneDigestMatches ?? false,
  oneToOne: extra.oneToOne ?? false, conflict: extra.conflict ?? false, role: extra.role || null,
  propertyResolved: extra.propertyResolved ?? false, contractCurrent: extra.contractCurrent ?? false,
  roleAmbiguous: extra.roleAmbiguous ?? false, propertyAmbiguous: extra.propertyAmbiguous ?? false,
  ambiguous: extra.ambiguous ?? false, confirmable: false, reason,
});

export async function loadValidatedExactPhoneCandidates(admin, references) {
  const refs = validateExactPhoneCandidateRefs(references);
  const { data, error } = await admin.from("respond_identity_links")
    .select("id,respond_contact_id,client_identity_id,link_status,link_source,confidence,reason_code")
    .eq("link_status", "candidate").eq("link_source", "exact_phone_unique")
    .eq("reason_code", "exact_full_phone_unique_candidate").eq("confidence", 0.95).limit(200);
  if (error) throw error;
  const byRef = new Map();
  for (const row of data || []) {
    const ref = exactPhoneCandidateRef(row.id);
    if (!refs.includes(ref)) continue;
    if (byRef.has(ref)) byRef.set(ref, null);
    else byRef.set(ref, row);
  }
  return refs.map((candidateRef) => ({ candidateRef, link: byRef.get(candidateRef) || null }));
}

export async function evaluateExactPhoneCandidateReadOnly(admin, { candidateRef, link, currentContact, effectiveAt = new Date().toISOString() }) {
  if (!link || !UUID.test(String(link.id || "")) || exactPhoneCandidateRef(link.id) !== candidateRef) return rejected(candidateRef, "candidate_not_found", { contactExists: false });
  const contactId = validateRespondContactId(link.respond_contact_id);
  if (!currentContact || String(currentContact.id || "") !== contactId) return rejected(candidateRef, "respond_contact_not_found", { contactExists: false });
  const normalizedPhone = contactPhoneFromRespondPayload({ contact: currentContact });
  if (!normalizedPhone) return rejected(candidateRef, "respond_phone_unusable");
  const phoneDigest = await sha256Hex(normalizedPhone);
  const [identity, digestMatches, contactLinks, identityLinks, roles, sources, tenantContracts, ownedProperties] = await Promise.all([
    admin.from("client_identities").select("id,status,phone_digest").eq("id", link.client_identity_id).maybeSingle(),
    admin.from("client_identities").select("id").eq("status", "active").eq("phone_digest", phoneDigest).limit(2),
    admin.from("respond_identity_links").select("id,client_identity_id,link_status").eq("respond_contact_id", contactId).in("link_status", ["candidate", "confirmed", "conflict"]),
    admin.from("respond_identity_links").select("id,respond_contact_id,link_status").eq("client_identity_id", link.client_identity_id).in("link_status", ["candidate", "confirmed", "conflict"]),
    admin.from("client_identity_roles").select("role_kind,status").eq("client_identity_id", link.client_identity_id),
    admin.from("client_source_links").select("source_type,source_id,role_kind,link_status,revoked_at").eq("client_identity_id", link.client_identity_id),
    admin.from("contracts").select("id,property_id,tenant_client_id,status,start_date,end_date").eq("tenant_client_id", link.client_identity_id),
    admin.from("properties").select("id,status,owner_client_id").eq("owner_client_id", link.client_identity_id),
  ]);
  for (const result of [identity, digestMatches, contactLinks, identityLinks, roles, sources, tenantContracts, ownedProperties]) if (result.error) throw result.error;
  const digestMatchesCurrent = identity.data?.status === "active" && identity.data?.phone_digest === phoneDigest;
  if (!digestMatchesCurrent) return rejected(candidateRef, "canonical_phone_mismatch");
  const canonicalUnique = (digestMatches.data || []).length === 1 && digestMatches.data[0].id === link.client_identity_id;
  if (!canonicalUnique) return rejected(candidateRef, "canonical_phone_not_unique", { phoneDigestMatches: true });
  const conflictingConfirmed = (contactLinks.data || []).some((row) => row.link_status === "confirmed" && row.client_identity_id !== link.client_identity_id);
  const contactReused = (identityLinks.data || []).some((row) => row.respond_contact_id !== contactId);
  if (conflictingConfirmed || contactReused) return rejected(candidateRef, conflictingConfirmed ? "confirmed_link_conflict" : "respond_contact_not_unique", { phoneDigestMatches: true, conflict: true });
  if ((sources.data || []).some((row) => row.link_status === "revoked" || row.revoked_at)) return rejected(candidateRef, "revoked_relationship", { phoneDigestMatches: true, oneToOne: true, conflict: true });
  const activeRoles = [...new Set((roles.data || []).filter((row) => row.status === "active" && ACTIVE_ROLE.has(row.role_kind)).map((row) => row.role_kind))];
  if (activeRoles.length !== 1) return rejected(candidateRef, "ambiguous_role_context", { phoneDigestMatches: true, oneToOne: true, roleAmbiguous: true, ambiguous: true });
  const role = activeRoles[0];
  const confirmedSources = new Set((sources.data || []).filter((row) => row.link_status === "confirmed").map((row) => `${row.source_type}:${row.source_id}`));
  if (role === "tenant") {
    const contracts = (tenantContracts.data || []).filter((row) => confirmedSources.has(`active_contract_tenant:${row.id}`) && contractIsCurrent(row, effectiveAt));
    const propertyIds = [...new Set(contracts.map((row) => row.property_id).filter(Boolean))];
    if (propertyIds.length !== 1) return rejected(candidateRef, propertyIds.length > 1 ? "ambiguous_property_context" : "contract_not_current", { phoneDigestMatches: true, oneToOne: true, role, propertyAmbiguous: propertyIds.length > 1, ambiguous: propertyIds.length > 1 });
    if (contracts.length !== 1) return rejected(candidateRef, "ambiguous_contract_context", { phoneDigestMatches: true, oneToOne: true, role, propertyResolved: true, ambiguous: true });
    const { data: property, error } = await admin.from("properties").select("id,status").eq("id", propertyIds[0]).maybeSingle();
    if (error) throw error;
    if (!property || !propertyIsCurrent(property)) return rejected(candidateRef, "property_not_current", { phoneDigestMatches: true, oneToOne: true, role });
    return { candidateRef, contactExists: true, phoneDigestMatches: true, oneToOne: true, conflict: false, role, propertyResolved: true, contractCurrent: true, roleAmbiguous: false, propertyAmbiguous: false, ambiguous: false, confirmable: true, reason: null };
  }
  const properties = (ownedProperties.data || []).filter((row) => row.owner_client_id === link.client_identity_id && propertyIsCurrent(row) && confirmedSources.has(`managed_property_owner:${row.id}`));
  if (properties.length !== 1) return rejected(candidateRef, properties.length > 1 ? "ambiguous_property_context" : "insufficient_property_context", { phoneDigestMatches: true, oneToOne: true, role, propertyAmbiguous: properties.length > 1, ambiguous: properties.length > 1 });
  const { data: contracts, error } = await admin.from("contracts").select("id,status,start_date,end_date").eq("property_id", properties[0].id);
  if (error) throw error;
  const currentContracts = (contracts || []).filter((row) => contractIsCurrent(row, effectiveAt));
  if (currentContracts.length > 1) return rejected(candidateRef, "ambiguous_contract_context", { phoneDigestMatches: true, oneToOne: true, role, propertyResolved: true, ambiguous: true });
  return { candidateRef, contactExists: true, phoneDigestMatches: true, oneToOne: true, conflict: false, role, propertyResolved: true, contractCurrent: currentContracts.length === 1, roleAmbiguous: false, propertyAmbiguous: false, ambiguous: false, confirmable: true, reason: null };
}

export async function evaluateExactPhoneCohortReadOnly(admin, { references, fetchContact, effectiveAt = new Date().toISOString() }) {
  const candidates = await loadValidatedExactPhoneCandidates(admin, references);
  const results = [];
  for (const candidate of candidates) {
    if (!candidate.link) { results.push(rejected(candidate.candidateRef, "candidate_not_found", { contactExists: false })); continue; }
    let currentContact;
    try { currentContact = await fetchContact(candidate.link.respond_contact_id); }
    catch (error) {
      const reason = Number(error?.public?.status) === 404 ? "respond_contact_not_found" : "respond_read_error";
      results.push(rejected(candidate.candidateRef, reason, { contactExists: false }));
      continue;
    }
    results.push(await evaluateExactPhoneCandidateReadOnly(admin, { ...candidate, currentContact, effectiveAt }));
  }
  return results;
}
