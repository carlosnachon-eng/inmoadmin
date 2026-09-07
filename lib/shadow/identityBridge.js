const CONTACT_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE = new Set(["activo", "active", "vigente"]);
const TERMINAL = new Set(["vencido", "expired", "cancelado", "cancelled", "terminado", "ended"]);
const INACTIVE_PROPERTY = new Set(["inactive", "inactiva", "inactivo", "archived", "archivada", "disabled", "deshabilitada"]);
const propertyIsCurrent = (row) => !INACTIVE_PROPERTY.has(String(row?.status || "").toLowerCase());

export function identityLinkCapabilities(env = {}) {
  return {
    enabled: env.SHADOW_IDENTITY_BRIDGE_ENABLED === "true",
    reviewWriteEnabled: env.SHADOW_IDENTITY_LINK_REVIEW_WRITE_ENABLED === "true",
  };
}

export function assertIdentityLinkReviewWrite(capabilities) {
  if (!capabilities?.reviewWriteEnabled) throw new Error("identity_link_review_write_disabled");
}

export function validateRespondContactId(value) {
  const id = String(value || "").trim();
  if (!CONTACT_ID.test(id)) throw new Error("invalid_respond_contact_id");
  return id;
}

export function normalizeIdentityPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 12 && digits.startsWith("52")) return digits;
  if (digits.length === 13 && digits.startsWith("521")) return `52${digits.slice(3)}`;
  return null;
}

export function contactPhoneFromRespondPayload(payload) {
  const contact = payload?.contact || {};
  const candidates = [contact.phone, contact.phoneNumber, contact.identifier, payload?.phone];
  return candidates.map(normalizeIdentityPhone).find(Boolean) || null;
}

const isoDay = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
};
const normalizedReference = (value) => String(value || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const referenceMatches = (reference, label) => {
  const wanted = normalizedReference(reference).split(" ").filter(Boolean);
  const available = new Set(normalizedReference(label).split(" ").filter(Boolean));
  return wanted.length > 0 && wanted.every((token) => available.has(token));
};
export function contractTemporalStatus(row, effectiveAt = new Date().toISOString()) {
  const effective = isoDay(effectiveAt);
  const start = isoDay(row.start_date || row.startDate);
  const end = isoDay(row.end_date || row.endDate);
  const stored = String(row.status || "").toLowerCase();
  if (!effective || (start && start > effective)) return "not_yet_active";
  if ((end && end < effective) || TERMINAL.has(stored)) return "expired";
  return ACTIVE.has(stored) || (start && !end) || (start && end) ? "active" : "unconfirmed";
}

export function buildCanonicalIdentityResolution({ link, identity, roles = [], sourceLinks = [], contracts = [], properties = [], effectiveAt, propertyId = null, propertyReference = null } = {}) {
  if (!link?.client_identity_id || identity?.status !== "active") return { resolved: false, identityConfirmed: false, reason: "canonical_identity_inactive", roles: [], contracts: [], properties: [] };
  const canonicalContactId = link.client_identity_id;
  const activeRoles = [...new Set(roles.filter((row) => row.status === "active").map((row) => row.role_kind).filter((role) => ["tenant", "owner"].includes(role)))];
  const confirmedSources = new Set(sourceLinks.filter((row) => row.link_status === "confirmed" && row.client_identity_id === canonicalContactId).map((row) => `${row.source_type}:${row.source_id}`));
  const canonicalProperties = properties.filter((row) => row.owner_client_id === canonicalContactId
      && propertyIsCurrent(row)
      && confirmedSources.has(`managed_property_owner:${row.id}`))
    .map((row) => ({ id: row.id, label: row.name || null, role: "owner", relationshipStatus: "active", source: "client_source_links" }));
  const ownedPropertyIds = new Set(canonicalProperties.filter((row) => row.role === "owner").map((row) => row.id));
  const canonicalContracts = contracts.filter((row) => (
    (row.tenant_client_id === canonicalContactId && confirmedSources.has(`active_contract_tenant:${row.id}`))
    || ownedPropertyIds.has(row.property_id)
  )).map((row) => {
    const temporalStatus = contractTemporalStatus(row, effectiveAt);
    return { id: row.id, propertyId: row.property_id, status: row.status, temporalStatus, active: temporalStatus === "active", startDate: row.start_date || null, endDate: row.end_date || null, role: row.tenant_client_id === canonicalContactId ? "tenant" : "owner", source: "client_source_links" };
  });
  for (const contract of canonicalContracts.filter((row) => row.active)) {
    if (!canonicalProperties.some((row) => row.id === contract.propertyId)) {
      const property = properties.find((row) => row.id === contract.propertyId);
      if (property && propertyIsCurrent(property)) {
        canonicalProperties.push({ id: contract.propertyId, label: property.name || null, role: "tenant", relationshipStatus: "active", source: "client_source_links" });
      }
    }
  }
  const currentProperties = canonicalProperties.filter((row) => row.relationshipStatus === "active");
  let selected = propertyId ? currentProperties.filter((row) => row.id === propertyId) : [];
  if (!selected.length && propertyReference) selected = currentProperties.filter((row) => referenceMatches(propertyReference, row.label));
  if (!propertyId && !propertyReference && currentProperties.length === 1) selected = currentProperties;
  const selectedIds = [...new Set(selected.map((row) => row.id))];
  const selectedRoles = [...new Set(selected.map((row) => row.role))];
  const currentPropertyIds = [...new Set(currentProperties.map((row) => row.id))];
  const ambiguity = selectedIds.length !== 1 || selectedRoles.length !== 1 || activeRoles.length !== 1;
  const applicableContracts = canonicalContracts.filter((row) => row.active && selectedIds.includes(row.propertyId));
  const reason = ambiguity
    ? (selectedIds.length === 1 && (selectedRoles.length > 1 || activeRoles.length > 1) ? "ambiguous_role_context" : currentPropertyIds.length > 1 ? "ambiguous_property_context" : "insufficient_property_context")
    : (selectedRoles[0] === "tenant" && applicableContracts.length !== 1 ? "contract_not_current" : null);
  return {
    resolved: true, identityConfirmed: true, canonicalContactId, linkId: link.id, linkSource: link.link_source,
    linkStatus: link.link_status, confidence: Number(link.confidence), roles: activeRoles,
    properties: reason ? [] : selected.filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index),
    associatedProperties: currentProperties, contracts: applicableContracts,
    currentContracts: canonicalContracts.filter((row) => row.active),
    historicalContracts: canonicalContracts.filter((row) => !row.active),
    relationshipCurrent: !reason, evidenceLevel: "confirmed_structured_link",
    evidenceSources: ["respond_identity_links", "client_identity_roles", "client_source_links"],
    ambiguousPropertyContext: reason === "ambiguous_property_context",
    ambiguousRoleContext: reason === "ambiguous_role_context",
    failClosedReason: reason,
    missingInformation: reason ? [reason] : [],
  };
}
export const sha256Hex = async (value) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const identityPhoneDigest = async (value) => {
  const normalized = normalizeIdentityPhone(value);
  return normalized ? sha256Hex(normalized) : null;
};

const exactPhoneEvidence = async ({ linkId, respondContactId, canonicalContactId, propertyId, contractId }) => ({
  evidenceVersion: "exact_phone_unique_v1",
  evidenceHash: await sha256Hex(JSON.stringify({ linkId, respondContactId, canonicalContactId, propertyId: propertyId || null, contractId: contractId || null })),
});

export async function evaluateExactPhoneIdentityCandidate(admin, { linkId, respondContactId, currentContact, effectiveAt = new Date().toISOString() } = {}) {
  if (!UUID.test(String(linkId || ""))) return { confirmable: false, reason: "candidate_not_found" };
  const contactId = validateRespondContactId(respondContactId);
  if (String(currentContact?.id || "") !== contactId) return { confirmable: false, reason: "respond_contact_mismatch" };
  const normalizedPhone = contactPhoneFromRespondPayload({ contact: currentContact });
  const phoneDigest = normalizedPhone ? await identityPhoneDigest(normalizedPhone) : null;
  if (!phoneDigest) return { confirmable: false, reason: "respond_phone_unusable" };
  const { data: link, error: linkError } = await admin.from("respond_identity_links")
    .select("id,respond_contact_id,client_identity_id,link_status,link_source,confidence,reason_code")
    .eq("id", linkId).eq("respond_contact_id", contactId).maybeSingle();
  if (linkError) throw linkError;
  if (!link || link.link_status !== "candidate" || link.link_source !== "exact_phone_unique" || Number(link.confidence) !== 0.95 || link.reason_code !== "exact_full_phone_unique_candidate") return { confirmable: false, reason: "candidate_not_exact_phone_unique" };
  const [identityResult, digestMatchesResult, contactLinksResult, identityLinksResult, rolesResult, sourcesResult, tenantContractsResult, ownedResult] = await Promise.all([
    admin.from("client_identities").select("id,status,phone_digest").eq("id", link.client_identity_id).maybeSingle(),
    admin.from("client_identities").select("id").eq("status", "active").eq("phone_digest", phoneDigest).limit(2),
    admin.from("respond_identity_links").select("id,client_identity_id,link_status").eq("respond_contact_id", contactId).in("link_status", ["candidate", "confirmed", "conflict"]),
    admin.from("respond_identity_links").select("id,respond_contact_id,link_status").eq("client_identity_id", link.client_identity_id).in("link_status", ["candidate", "confirmed", "conflict"]),
    admin.from("client_identity_roles").select("client_identity_id,role_kind,status").eq("client_identity_id", link.client_identity_id),
    admin.from("client_source_links").select("client_identity_id,source_type,source_id,role_kind,link_status,confirmed_at,revoked_at").eq("client_identity_id", link.client_identity_id),
    admin.from("contracts").select("id,property_id,tenant_client_id,status,start_date,end_date").eq("tenant_client_id", link.client_identity_id),
    admin.from("properties").select("id,name,status,owner_client_id").eq("owner_client_id", link.client_identity_id),
  ]);
  for (const result of [identityResult, digestMatchesResult, contactLinksResult, identityLinksResult, rolesResult, sourcesResult, tenantContractsResult, ownedResult]) if (result.error) throw result.error;
  if (identityResult.data?.status !== "active" || identityResult.data?.phone_digest !== phoneDigest) return { confirmable: false, reason: "canonical_phone_mismatch" };
  if ((digestMatchesResult.data || []).length !== 1 || digestMatchesResult.data[0].id !== link.client_identity_id) return { confirmable: false, reason: "canonical_phone_not_unique" };
  if ((contactLinksResult.data || []).some((row) => row.link_status === "confirmed" && row.client_identity_id !== link.client_identity_id)) return { confirmable: false, reason: "confirmed_link_conflict" };
  if ((identityLinksResult.data || []).some((row) => row.respond_contact_id !== contactId)) return { confirmable: false, reason: "respond_contact_not_unique" };
  if ((sourcesResult.data || []).some((row) => row.link_status === "revoked")) return { confirmable: false, reason: "revoked_relationship" };
  const propertyIds = [...new Set([...(tenantContractsResult.data || []).map((row) => row.property_id), ...(ownedResult.data || []).map((row) => row.id)].filter(Boolean))];
  const propertiesResult = propertyIds.length ? await admin.from("properties").select("id,name,status,owner_client_id").in("id", propertyIds) : { data: [], error: null };
  const allContractsResult = propertyIds.length ? await admin.from("contracts").select("id,property_id,tenant_client_id,status,start_date,end_date").in("property_id", propertyIds) : tenantContractsResult;
  if (propertiesResult.error || allContractsResult.error) throw propertiesResult.error || allContractsResult.error;
  const resolution = buildCanonicalIdentityResolution({ link: { ...link, link_status: "confirmed" }, identity: identityResult.data, roles: rolesResult.data, sourceLinks: sourcesResult.data, contracts: allContractsResult.data, properties: propertiesResult.data, effectiveAt });
  if (!resolution.relationshipCurrent) return { confirmable: false, reason: resolution.failClosedReason || "relationship_not_current" };
  const propertyId = resolution.properties[0]?.id || null;
  const contractId = resolution.contracts.length === 1 ? resolution.contracts[0].id : null;
  if (resolution.roles[0] === "owner" && resolution.contracts.length > 1) return { confirmable: false, reason: "ambiguous_contract_context" };
  const evidence = await exactPhoneEvidence({ linkId: link.id, respondContactId: contactId, canonicalContactId: link.client_identity_id, propertyId, contractId });
  return { confirmable: true, reason: null, linkId: link.id, respondContactId: contactId, canonicalContactId: link.client_identity_id, role: resolution.roles[0], propertyId, contractId, effectiveAt, phoneDigest, ...evidence };
}

export async function confirmExactPhoneIdentityCandidate(admin, assessment, actorProfileId) {
  if (!assessment?.confirmable || !UUID.test(String(actorProfileId || ""))) throw new Error("exact_phone_confirmation_not_allowed");
  const { data, error } = await admin.rpc("confirm_exact_phone_respond_identity_link", {
    p_link_id: assessment.linkId, p_respond_contact_id: validateRespondContactId(assessment.respondContactId),
    p_phone_digest: assessment.phoneDigest, p_effective_at: assessment.effectiveAt,
    p_evidence_version: assessment.evidenceVersion, p_evidence_hash: assessment.evidenceHash, p_actor_profile_id: actorProfileId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function generateIdentityCandidates(admin, { respondContactId, normalizedPhone }) {
  const contactId = validateRespondContactId(respondContactId);
  const phone = normalizeIdentityPhone(normalizedPhone);
  if (!phone) return { status: "no_candidate", candidates: 0 };
  const { data: prior, error: priorError } = await admin.from("respond_identity_links").select("link_status").eq("respond_contact_id", contactId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (priorError) throw priorError;
  if (prior?.link_status) return { status: prior.link_status, candidates: 0, existing: true };
  const phoneDigest = await sha256Hex(phone);
  const { data: candidateRows, error: candidateError } = await admin.rpc("find_respond_identity_candidates", { p_phone_digest: phoneDigest });
  if (candidateError) throw candidateError;
  const matches = new Map();
  for (const row of candidateRows || []) {
    if (!row.client_identity_id) continue;
    const item = matches.get(row.client_identity_id) || { clientIdentityId: row.client_identity_id, contracts: [], properties: [] };
    if (row.contract_id) item.contracts.push(row.contract_id);
    if (row.property_id) item.properties.push(row.property_id);
    matches.set(row.client_identity_id, item);
  }
  const candidates = [...matches.values()];
  if (!candidates.length) return { status: "no_candidate", candidates: 0 };
  const status = candidates.length === 1 ? "candidate" : "conflict";
  const source = candidates.length === 1 ? "exact_phone_unique" : "exact_phone_conflict";
  for (const item of candidates) {
    const { data: existing, error: existingError } = await admin.from("respond_identity_links").select("id").eq("respond_contact_id", contactId).eq("client_identity_id", item.clientIdentityId).in("link_status", ["candidate", "confirmed", "conflict"]).maybeSingle();
    if (existingError) throw existingError;
    let link = existing;
    if (!link) {
      const { data: inserted, error } = await admin.from("respond_identity_links").insert({
        respond_contact_id: contactId, client_identity_id: item.clientIdentityId, inmoadmin_client_id: null, link_status: status,
        link_source: source, confidence: candidates.length === 1 ? 0.95 : 0.5,
        reason_code: candidates.length === 1 ? "exact_full_phone_unique_candidate" : "multiple_exact_full_phone_candidates",
      }).select("id").single();
      if (error) throw error; link = inserted;
    }
    await admin.from("respond_identity_audit").insert({
      link_id: link?.id || null, respond_contact_id: contactId,
      event_type: status === "candidate" ? "candidate_created" : "conflict_detected",
      context_ids: { contractIds: item.contracts.slice(0, 10), propertyIds: [...new Set(item.properties)].slice(0, 10) },
      conflict_count: Math.max(0, candidates.length - 1),
    });
  }
  return { status, candidates: candidates.length };
}

export async function resolveConfirmedContactIdentity(admin, respondContactId, { audit = true, effectiveAt = new Date().toISOString(), propertyId = null, propertyReference = null } = {}) {
  const contactId = validateRespondContactId(respondContactId);
  const { data: links, error } = await admin.from("respond_identity_links")
    .select("id,client_identity_id,link_status,link_source,confidence,confirmed_at")
    .eq("respond_contact_id", contactId).eq("link_status", "confirmed").limit(2);
  if (error) throw error;
  if ((links || []).length !== 1) {
    if (audit) await admin.from("respond_identity_audit").insert({ respond_contact_id: contactId, event_type: "unresolved", conflict_count: Math.max(0, (links || []).length - 1) });
    return { resolved: false, reason: (links || []).length > 1 ? "identity_conflict" : "insufficient_identity_context", roles: [], contracts: [], properties: [] };
  }
  const link = links[0];
  const [identityResult, rolesResult, sourcesResult, contractsResult, ownedResult] = await Promise.all([
    admin.from("client_identities").select("id,status").eq("id", link.client_identity_id).maybeSingle(),
    admin.from("client_identity_roles").select("client_identity_id,role_kind,status").eq("client_identity_id", link.client_identity_id),
    admin.from("client_source_links").select("client_identity_id,source_type,source_id,role_kind,link_status,confirmed_at,revoked_at").eq("client_identity_id", link.client_identity_id),
    admin.from("contracts").select("id,property_id,tenant_client_id,status,start_date,end_date").eq("tenant_client_id", link.client_identity_id),
    admin.from("properties").select("id,name,status,owner_client_id").eq("owner_client_id", link.client_identity_id),
  ]);
  for (const result of [identityResult, rolesResult, sourcesResult, contractsResult, ownedResult]) if (result.error) throw result.error;
  const propertyIds = [...new Set([...(contractsResult.data || []).map((row) => row.property_id), ...(ownedResult.data || []).map((row) => row.id)].filter(Boolean))];
  const propertyResult = propertyIds.length
    ? await admin.from("properties").select("id,name,status,owner_client_id").in("id", propertyIds)
    : { data: [], error: null };
  if (propertyResult.error) throw propertyResult.error;
  const properties = propertyResult.data || [];
  const allContractsResult = propertyIds.length
    ? await admin.from("contracts").select("id,property_id,tenant_client_id,status,start_date,end_date").in("property_id", propertyIds)
    : contractsResult;
  if (allContractsResult.error) throw allContractsResult.error;
  const resolution = buildCanonicalIdentityResolution({ link, identity: identityResult.data, roles: rolesResult.data, sourceLinks: sourcesResult.data, contracts: allContractsResult.data, properties, effectiveAt, propertyId, propertyReference });
  if (audit) await admin.from("respond_identity_audit").insert({ link_id: link.id, respond_contact_id: contactId, event_type: resolution.relationshipCurrent ? "resolved" : "unresolved", context_ids: { clientIdentityId: link.client_identity_id, contractIds: resolution.contracts.map((x) => x.id).slice(0, 10), propertyIds: resolution.properties.map((x) => x.id).slice(0, 10), failClosedReason: resolution.failClosedReason } });
  return { ...resolution, clientContextKey: resolution.canonicalContactId };
}

export async function reviewIdentityLink(admin, { linkId, action, actorProfileId }) {
  if (!UUID.test(String(linkId || "")) || !UUID.test(String(actorProfileId || ""))) throw new Error("invalid_identity_review");
  if (!["confirm", "reject", "conflict", "revoke"].includes(action)) throw new Error("invalid_identity_review");
  const { data: current, error } = await admin.from("respond_identity_links").select("*").eq("id", linkId).maybeSingle();
  if (error) throw error; if (!current) throw new Error("identity_link_not_found");
  if (action === "confirm" && !current.client_identity_id) throw new Error("canonical_identity_required");
  const now = new Date().toISOString();
  const target = { confirm: "confirmed", reject: "rejected", conflict: "conflict", revoke: "revoked" }[action];
  const patch = { link_status: target, reviewed_by: actorProfileId, reviewed_at: now, updated_at: now,
    ...(target === "confirmed" ? { confirmed_by: actorProfileId, confirmed_at: now, link_source: "human_confirmation", confidence: 1 } : {}),
    ...(target !== "confirmed" ? { confirmed_by: null, confirmed_at: null } : {}),
    ...(target === "revoked" ? { revoked_at: now } : {}),
  };
  const { data, error: updateError } = await admin.from("respond_identity_links").update(patch).eq("id", linkId).select("id,link_status").single();
  if (updateError) throw updateError;
  await admin.from("respond_identity_audit").insert({ link_id: linkId, respond_contact_id: current.respond_contact_id, event_type: target === "confirmed" ? "confirmed" : target === "rejected" ? "rejected" : target === "revoked" ? "revoked" : "conflict_detected", actor_profile_id: actorProfileId });
  return data;
}
