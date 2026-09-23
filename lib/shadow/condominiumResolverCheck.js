import { CONDOMINIUM_OWNER_SOURCE, CONDOMINIUM_RESPOND_SOURCE, condominiumIdentityRef, loadCondominiumIdentityBefore3A } from "./condominiumIdentity.js";

const EVIDENCE_VERSION = "condominium_owner_review_v1";
const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const RESOLVER_REASONS = new Set([
  "canonical_identity_inactive", "canonical_role_conflict", "mixed_domain_requires_structured_review",
  "no_approved_condominium_relationship", "inactive_or_changed_condominium_relationship",
  "source_relationship_changed", "approved_source_phone_changed", "identity_conflict", "insufficient_identity_context",
]);
const read = async (query) => {
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new Error("condominium_resolver_read_failed");
  return data;
};

export function validateCondominiumResolverCheck(body) {
  if (!body || body.action !== "condominium_resolver_check" || typeof body.candidateRef !== "string"
    || !/^[a-f0-9]{12}$/.test(body.candidateRef)
    || Object.keys(body).length !== 2) throw new Error("invalid_condominium_resolver_check");
  return body.candidateRef;
}

// Resolve the certified opaque hash server-side. Only IDs are scanned, never phones/names.
// Do not silently truncate a search (or accept an ambiguous 48-bit reference).
async function findCandidateId(admin, candidateRef) {
  let found = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const ids = await read(admin.from("client_reconciliation_candidates").select("id")
      .eq("evidence_version", EVIDENCE_VERSION).order("id", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1));
    for (const row of ids) {
      if (await condominiumIdentityRef("candidate", row.id) !== candidateRef) continue;
      if (found) throw new Error("candidate_reference_ambiguous");
      found = row.id;
    }
    if (ids.length < PAGE_SIZE) {
      if (!found) throw new Error("candidate_not_found");
      return found;
    }
  }
  throw new Error("candidate_lookup_limit");
}

// SELECT-only diagnostic. No gateway, model, Respond request, operational tools or audit.
export async function checkCondominiumResolver(admin, candidateRef) {
  validateCondominiumResolverCheck({ action: "condominium_resolver_check", candidateRef });
  const id = await findCandidateId(admin, candidateRef);
  const [candidate] = await read(admin.from("client_reconciliation_candidates")
    .select("id,candidate_status,evidence_version,role_kind,client_identity_id,respond_contact_id")
    .eq("id", id).eq("evidence_version", EVIDENCE_VERSION));
  if (!candidate) throw new Error("candidate_not_found");
  if (candidate.candidate_status !== "confirmed") throw new Error("candidate_not_confirmed");
  if (candidate.role_kind !== "owner" || !candidate.client_identity_id || !candidate.respond_contact_id) throw new Error("candidate_scope_mismatch");
  const sources = await read(admin.from("client_reconciliation_candidate_sources")
    .select("source_type,source_id,condominium_id").eq("candidate_id", id));
  if (sources.length !== 1 || sources[0].source_type !== CONDOMINIUM_OWNER_SOURCE
    || !sources[0].source_id || !sources[0].condominium_id) throw new Error("candidate_scope_mismatch");

  // This is the unmodified production resolver, not a reconstruction of its decisions.
  const tool = await loadCondominiumIdentityBefore3A(admin, candidate.respond_contact_id);
  const identities = (tool?.result || []).filter((row) => row.entityType === "contact_identity");
  const identity = identities.length === 1 ? identities[0] : null;
  const units = (tool?.result || []).filter((row) => row.entityType === "condominium_unit");
  const unit = units.length === 1 ? units[0] : null;
  const result = {
    candidateRef,
    resolved: identity?.resolved === true,
    identityDomain: identity?.identityDomain === "condominium" ? "condominium" : null,
    roles: identity?.roles?.length === 1 && identity.roles[0] === "owner" ? ["owner"] : [],
    linkSource: identity?.linkSource === CONDOMINIUM_RESPOND_SOURCE ? CONDOMINIUM_RESPOND_SOURCE : null,
    unitRef: unit?.unitId ? await condominiumIdentityRef("unit", unit.unitId) : null,
    condominiumRef: unit?.condominiumId ? await condominiumIdentityRef("condominium", unit.condominiumId) : null,
    ambiguousUnitContext: typeof identity?.ambiguousUnitContext === "boolean" ? identity.ambiguousUnitContext : null,
  };
  let reason;
  if (!result.resolved) reason = RESOLVER_REASONS.has(identity?.status) ? identity.status : "insufficient_identity_context";
  else if (identity.internalId !== candidate.client_identity_id) reason = "candidate_identity_mismatch";
  else if (!result.identityDomain || !result.linkSource || !result.roles.length || identity.status !== "confirmed") reason = "resolver_context_mismatch";
  else if (result.ambiguousUnitContext !== false || units.length !== 1) reason = "insufficient_unit_context";
  else if (!unit.active || !unit.selected || unit.unitId !== sources[0].source_id || unit.condominiumId !== sources[0].condominium_id) reason = "candidate_unit_mismatch";

  // A concurrent review must not turn a stale confirmed candidate into a diagnostic PASS.
  const [current] = await read(admin.from("client_reconciliation_candidates")
    .select("candidate_status,client_identity_id,respond_contact_id").eq("id", id));
  if (current?.candidate_status !== "confirmed" || current.client_identity_id !== candidate.client_identity_id
    || current.respond_contact_id !== candidate.respond_contact_id) reason = "candidate_changed_during_check";
  if (reason) return { ...result, resolved: false, reason };
  return result;
}
