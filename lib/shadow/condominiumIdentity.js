import { normalizeIdentityPhone, validateRespondContactId } from "./identityBridge.js";

export const CONDOMINIUM_OWNER_SOURCE = "condominium_unit_owner";
export const CONDOMINIUM_RESPOND_SOURCE = "condominium_owner_admin_review";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = async (text) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
export const condominiumIdentityRef = async (kind, id) => (await sha256(`${kind}:${id}`)).slice(0, 12);
const rows = async (query) => { const { data, error } = await query; if (error) throw new Error("condominium_identity_read_failed"); return data || []; };

export function condominiumReviewCapabilities(env = {}) {
  return { prepare: env.SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED === "true",
    review: env.SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED === "true" && env.SHADOW_IDENTITY_CONFIRMATION_ENABLED === "true" };
}

export async function listCondominiumIdentityReview(admin) {
  const [units, candidates, sources] = await Promise.all([
    rows(admin.from("unidades_condominio").select("id,condominio_id,activo").order("id").limit(500)),
    rows(admin.from("client_reconciliation_candidates").select("id,respond_contact_id,candidate_status,reason_code,evidence_version,respond_checked_at").eq("evidence_version", "condominium_owner_review_v1").order("created_at", { ascending: false }).limit(200)),
    rows(admin.from("client_reconciliation_candidate_sources").select("candidate_id,source_id,condominium_id").eq("source_type", CONDOMINIUM_OWNER_SOURCE)),
  ]);
  return {
    units: await Promise.all(units.map(async (u) => ({ unitId: u.id, unitRef: await condominiumIdentityRef("unit", u.id), condominiumRef: await condominiumIdentityRef("condominium", u.condominio_id), active: u.activo === true }))),
    candidates: await Promise.all(candidates.map(async (c) => {
      const source = sources.find((s) => s.candidate_id === c.id);
      return { candidateId: c.id, candidateRef: await condominiumIdentityRef("candidate", c.id), contactRef: await condominiumIdentityRef("respond", c.respond_contact_id),
        unitRef: source ? await condominiumIdentityRef("unit", source.source_id) : null,
        condominiumRef: source ? await condominiumIdentityRef("condominium", source.condominium_id) : null,
        status: c.candidate_status, reason: c.reason_code, checkedAt: c.respond_checked_at, source: CONDOMINIUM_OWNER_SOURCE };
    })),
  };
}

export async function reviewCondominiumIdentity({ admin, actor, body, fetchContact, env = {}, now = () => new Date().toISOString() }) {
  if (!actor?.id || actor.active !== true || actor.role_id !== "admin") throw new Error("admin_required");
  const action = String(body?.action || "").replace(/^condominium_/, "");
  const allowed = action === "prepare" ? ["action", "unitId", "respondContactId", "attachConfirmedIdentity", "ownershipReviewed"] : ["action", "candidateId", "ownershipReviewed"];
  if (!["prepare", "confirm", "reject", "revoke"].includes(action) || Object.keys(body || {}).some((k) => !allowed.includes(k))) throw new Error("invalid_condominium_review");
  const caps = condominiumReviewCapabilities(env);
  if (action === "prepare" ? !caps.prepare : !caps.review) throw new Error("condominium_review_disabled");
  if (action === "confirm" && body.ownershipReviewed !== true) throw new Error("explicit_ownership_review_required");
  if (action === "prepare" && body.attachConfirmedIdentity === true && body.ownershipReviewed !== true) throw new Error("explicit_ownership_review_required");
  let unitId, contactId, candidateId = null;
  if (action === "prepare") {
    unitId = body.unitId; contactId = validateRespondContactId(body.respondContactId);
  } else {
    candidateId = body.candidateId;
    if (!UUID.test(String(candidateId || ""))) throw new Error("invalid_candidate");
    const [candidate] = await rows(admin.from("client_reconciliation_candidates").select("id,respond_contact_id,evidence_version").eq("id", candidateId));
    const sources = await rows(admin.from("client_reconciliation_candidate_sources").select("source_type,source_id,condominium_id").eq("candidate_id", candidateId));
    if (!candidate || candidate.evidence_version !== "condominium_owner_review_v1" || sources.length !== 1 || sources[0].source_type !== CONDOMINIUM_OWNER_SOURCE) throw new Error("candidate_scope_mismatch");
    unitId = sources[0].source_id; contactId = validateRespondContactId(candidate.respond_contact_id);
  }
  if (!UUID.test(String(unitId || ""))) throw new Error("invalid_unit");
  let phoneDigest = null, observedAt = null, serverRejection = null;
  if (["prepare", "confirm"].includes(action)) {
    try {
      const contact = await fetchContact(contactId);
      if (String(contact?.id || "") !== contactId) serverRejection = "respond_contact_not_found";
      else {
        // Never use name, email, free identifiers or conversation text as evidence.
        const phone = normalizeIdentityPhone(contact.phone || contact.phoneNumber);
        if (!phone) serverRejection = "respond_phone_unusable";
        else phoneDigest = await sha256(phone);
      }
      observedAt = now();
    } catch { serverRejection = "respond_read_error"; }
  }
  const { data, error } = await admin.rpc("review_condominium_owner_identity", {
    p_action: action, p_unit_id: unitId, p_respond_contact_id: contactId, p_actor_profile_id: actor.id,
    p_observed_digest: phoneDigest, p_observed_at: observedAt, p_candidate_id: candidateId, p_server_rejection: serverRejection,
    p_attach_confirmed_identity: action === "prepare" && body.attachConfirmedIdentity === true,
  });
  if (error) throw new Error("condominium_review_failed");
  return { status: data?.status || "rejected", reason: data?.reason || null,
    candidateRef: data?.candidate_id ? await condominiumIdentityRef("candidate", data.candidate_id) : null,
    unitRef: await condominiumIdentityRef("unit", unitId), contactRef: await condominiumIdentityRef("respond", contactId) };
}

// New approved source only. The historical 7/7 resolver path remains unchanged.
export async function resolveApprovedCondominiumIdentity(admin, link) {
  const unresolved = (reason) => ({ resolved: false, reason, roles: [], contracts: [], properties: [], units: [], identityDomain: "condominium" });
  const [identity] = await rows(admin.from("client_identities").select("id,status,revoked_at,phone_digest").eq("id", link.client_identity_id));
  const roles = await rows(admin.from("client_identity_roles").select("role_kind,status").eq("client_identity_id", link.client_identity_id));
  if (!identity || identity.status !== "active" || identity.revoked_at) return unresolved("canonical_identity_inactive");
  if (roles.length !== 1 || roles[0].role_kind !== "owner" || roles[0].status !== "active") return unresolved("canonical_role_conflict");
  const links = await rows(admin.from("client_source_links").select("source_id,source_type,condominium_id,source_version,link_status,revoked_at,role_kind").eq("client_identity_id", identity.id));
  if (links.some((s) => s.source_type !== CONDOMINIUM_OWNER_SOURCE)) return unresolved("mixed_domain_requires_structured_review");
  const approved = links.filter((s) => s.link_status === "confirmed" && !s.revoked_at && s.role_kind === "owner");
  if (!approved.length) return unresolved("no_approved_condominium_relationship");
  const units = await rows(admin.from("unidades_condominio").select("id,condominio_id,activo,propietario_telefono,identity_owner_version").in("id", approved.map((s) => s.source_id)));
  const condominiums = await rows(admin.from("condominios").select("id,activo").in("id", [...new Set(approved.map((s) => s.condominium_id))]));
  // Do not silently discard invalid relationships and select a remaining unit.
  if (units.length !== approved.length || approved.some((s) => !units.some((u) => u.id === s.source_id && u.condominio_id === s.condominium_id && u.activo === true)
    || !condominiums.some((c) => c.id === s.condominium_id && c.activo === true))) return unresolved("inactive_or_changed_condominium_relationship");
  if (approved.some((s) => !Number.isSafeInteger(Number(s.source_version)) || Number(s.source_version)<1
    || !units.some((u) => u.id === s.source_id && String(u.identity_owner_version) === String(s.source_version)))) return unresolved("source_relationship_changed");
  const digests = await Promise.all(units.map(async (u) => { const phone = normalizeIdentityPhone(u.propietario_telefono); return phone ? sha256(phone) : null; }));
  if (digests.some((digest) => !digest || digest !== identity.phone_digest)) return unresolved("approved_source_phone_changed");
  const safeUnits = units.map((u) => ({ id: u.id, condominiumId: u.condominio_id, active: true })).sort((a, b) => a.id.localeCompare(b.id));
  return { resolved: true, clientContextKey: identity.id, linkId: link.id, linkStatus: "confirmed", linkSource: CONDOMINIUM_RESPOND_SOURCE,
    identityDomain: "condominium", roles: ["owner"], contracts: [], properties: [], units: safeUnits,
    ambiguousPropertyContext: false, ambiguousUnitContext: safeUnits.length !== 1,
    selectedUnitId: safeUnits.length === 1 ? safeUnits[0].id : null,
    missingInformation: safeUnits.length === 1 ? [] : ["insufficient_unit_context"] };
}

export function condominiumIdentityToolRows(identity, contactId) {
  if (!identity.resolved) return [{ entityType: "contact_identity", internalId: contactId, status: identity.reason, resolved: false, identityDomain: "condominium", linkSource: CONDOMINIUM_RESPOND_SOURCE }];
  return [{ entityType: "contact_identity", internalId: identity.clientContextKey, linkId: identity.linkId, status: "confirmed", resolved: true,
    linkSource: identity.linkSource, roles: identity.roles, identityDomain: "condominium", ambiguousUnitContext: identity.ambiguousUnitContext },
    ...identity.units.map((u) => ({ entityType: "condominium_unit", internalId: u.id, unitId: u.id, condominiumId: u.condominiumId,
      active: true, method: "confirmed_identity_link", selected: u.id === identity.selectedUnitId, reasonCode: "approved_condominium_owner_source" }))];
}

export async function loadCondominiumIdentityBefore3A(admin, contactId) {
  if (!admin || !contactId) return null;
  const links = (await rows(admin.from("respond_identity_links").select("id,client_identity_id,link_source,link_status").eq("respond_contact_id", validateRespondContactId(contactId)).eq("link_source", CONDOMINIUM_RESPOND_SOURCE)))
    .filter((link) => link.link_source === CONDOMINIUM_RESPOND_SOURCE);
  if (!links.length) return null;
  const live = links.filter((l) => l.link_status === "confirmed");
  const identity = live.length === 1 ? await resolveApprovedCondominiumIdentity(admin, live[0]) : { resolved: false, reason: live.length > 1 ? "identity_conflict" : "insufficient_identity_context" };
  return { name: "resolve_contact_identity", args: { respondContactId: contactId }, ok: true, source: "policy_required", reason: "pre_3a_approved_condominium_identity", result: condominiumIdentityToolRows(identity, contactId) };
}
