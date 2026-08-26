import { createHash } from "node:crypto";
import { normalizeIdentityPhone } from "./identityBridge.js";

const ACTIVE = new Set(["activo", "active"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact = (value) => String(value || "").trim().toLocaleLowerCase("es-MX");
const digest = (value) => createHash("sha256").update(String(value)).digest("hex");
const distinct = (values) => new Set(values.map(exact).filter(Boolean)).size;

export const RECONCILIATION_PREPARE_LIMITS = Object.freeze({ tenants: 5, owners: 3, total: 8 });

export function clientReconciliationCapabilities(env = {}) {
  return {
    prepareEnabled: env.SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED === "true",
    writeEnabled: env.SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED === "true",
  };
}

export function assertClientReconciliationAction(capabilities, action) {
  if (action === "prepare") {
    if (!capabilities?.prepareEnabled) throw new Error("client_reconciliation_prepare_disabled");
    return;
  }
  if (!capabilities?.writeEnabled) throw new Error("client_reconciliation_write_disabled");
}

export function validateExplicitReconciliationSelection(value = {}) {
  const tenantSourceIds = [...new Set(Array.isArray(value.tenantSourceIds) ? value.tenantSourceIds.map(String) : [])];
  const ownerSourceIds = [...new Set(Array.isArray(value.ownerSourceIds) ? value.ownerSourceIds.map(String) : [])];
  if (!tenantSourceIds.length && !ownerSourceIds.length) throw new Error("empty_reconciliation_selection");
  if (tenantSourceIds.length > RECONCILIATION_PREPARE_LIMITS.tenants || ownerSourceIds.length > RECONCILIATION_PREPARE_LIMITS.owners || tenantSourceIds.length + ownerSourceIds.length > RECONCILIATION_PREPARE_LIMITS.total) throw new Error("reconciliation_selection_limit_exceeded");
  if (![...tenantSourceIds, ...ownerSourceIds].every((id) => UUID.test(id))) throw new Error("invalid_reconciliation_source_id");
  return { tenantSourceIds, ownerSourceIds };
}

export function selectExplicitReconciliationCohort(cohort, selection) {
  const valid = validateExplicitReconciliationSelection(selection);
  const tenantIds = new Set(valid.tenantSourceIds);
  const ownerIds = new Set(valid.ownerSourceIds);
  const candidates = (cohort?.candidates || []).flatMap((candidate) => {
    const allowed = candidate.roleKind === "tenant" ? tenantIds : candidate.roleKind === "owner" ? ownerIds : null;
    if (!allowed) return [];
    const sources = candidate.sources.filter((source) => allowed.has(source.sourceId));
    return sources.length ? [{ ...candidate, sources }] : [];
  });
  const representedTenants = new Set(candidates.filter((x) => x.roleKind === "tenant").flatMap((x) => x.sources.map((source) => source.sourceId)));
  const representedOwners = new Set(candidates.filter((x) => x.roleKind === "owner").flatMap((x) => x.sources.map((source) => source.sourceId)));
  if (representedTenants.size !== tenantIds.size || representedOwners.size !== ownerIds.size) throw new Error("reconciliation_selection_not_eligible");
  return { candidates, metrics: {
    requestedTenants: tenantIds.size, requestedOwners: ownerIds.size, preparedCandidates: candidates.length,
    autoSafe: candidates.filter((x) => x.candidateStatus === "auto_safe_candidate").length,
    requiresReview: candidates.filter((x) => x.candidateStatus === "requires_review").length,
    conflicts: candidates.filter((x) => x.candidateStatus === "conflict").length,
    skipped: candidates.filter((x) => x.candidateStatus === "skipped").length,
  } };
}

export const canonicalCandidateKey = ({ roleKind, phoneDigest, sourceId }) => digest(
  phoneDigest ? `${roleKind}:phone:${phoneDigest}` : `${roleKind}:source:${sourceId}`
);

export function buildActiveClientReconciliationCohort({ contracts = [], properties = [], ownerSourceIds = [] } = {}) {
  const active = contracts.filter((row) => ACTIVE.has(String(row.status || "").toLowerCase()));
  const propertyGroups = new Map();
  for (const property of properties) {
    const key = exact(property.name);
    if (!key) continue;
    propertyGroups.set(key, [...(propertyGroups.get(key) || []), property]);
  }
  const candidates = [];
  const tenantGroups = new Map();
  const matchedProperties = new Map();

  for (const contract of active) {
    const matches = propertyGroups.get(exact(contract.property_name)) || [];
    const matchedPropertyId = matches.length === 1 ? matches[0].id : null;
    if (matches.length === 1) matchedProperties.set(matches[0].id, { property: matches[0], ownerNames: [contract.owner_name] });
    const phone = normalizeIdentityPhone(contract.tenant_phone);
    const phoneDigest = phone ? digest(phone) : null;
    const groupKey = phoneDigest || `invalid:${contract.id}`;
    const group = tenantGroups.get(groupKey) || { roleKind: "tenant", phoneDigest, rows: [] };
    group.rows.push({ sourceType: "active_contract_tenant", sourceId: contract.id, matchedPropertyId, name: contract.tenant_name, email: contract.tenant_email, propertyMatchCount: matches.length });
    tenantGroups.set(groupKey, group);
  }
  const explicitOwnerIds = new Set(ownerSourceIds.map(String));
  for (const property of properties) {
    if (explicitOwnerIds.has(String(property.id)) && !matchedProperties.has(property.id)) matchedProperties.set(property.id, { property, ownerNames: [null] });
  }

  for (const group of tenantGroups.values()) {
    const conflicts = distinct(group.rows.map((x) => x.name)) > 1 || distinct(group.rows.map((x) => x.email)) > 1;
    const propertyAmbiguous = group.rows.some((x) => x.propertyMatchCount !== 1);
    const status = !group.phoneDigest ? "requires_review" : conflicts || propertyAmbiguous ? "conflict" : "auto_safe_candidate";
    const reasonCode = !group.phoneDigest ? "tenant_phone_invalid" : conflicts ? "tenant_identity_conflict" : propertyAmbiguous ? "property_match_not_unique" : "exact_phone_unique_active_tenant";
    candidates.push({ candidateKey: canonicalCandidateKey({ roleKind: "tenant", phoneDigest: group.phoneDigest, sourceId: group.rows[0].sourceId }), roleKind: "tenant", phoneDigest: group.phoneDigest, candidateStatus: status, reasonCode, matchMethod: group.phoneDigest ? "exact_full_phone_candidate" : "manual_review_required", sources: group.rows.map(({ name, email, propertyMatchCount, ...row }) => row) });
  }

  const ownerGroups = new Map();
  for (const { property, ownerNames } of matchedProperties.values()) {
    const phone = normalizeIdentityPhone(property.owner_phone);
    const phoneDigest = phone ? digest(phone) : null;
    const groupKey = phoneDigest || `invalid:${property.id}`;
    const group = ownerGroups.get(groupKey) || { roleKind: "owner", phoneDigest, rows: [] };
    group.rows.push({ sourceType: "managed_property_owner", sourceId: property.id, matchedPropertyId: property.id, name: ownerNames[0], email: property.owner_email });
    ownerGroups.set(groupKey, group);
  }
  for (const group of ownerGroups.values()) {
    const conflicts = distinct(group.rows.map((x) => x.name)) > 1 || distinct(group.rows.map((x) => x.email)) > 1;
    const status = !group.phoneDigest ? "requires_review" : conflicts ? "conflict" : "auto_safe_candidate";
    const reasonCode = !group.phoneDigest ? "owner_phone_invalid" : conflicts ? "owner_identity_conflict" : "exact_phone_unique_managed_owner";
    candidates.push({ candidateKey: canonicalCandidateKey({ roleKind: "owner", phoneDigest: group.phoneDigest, sourceId: group.rows[0].sourceId }), roleKind: "owner", phoneDigest: group.phoneDigest, candidateStatus: status, reasonCode, matchMethod: group.phoneDigest ? "exact_full_phone_candidate" : "manual_review_required", sources: group.rows.map(({ name, email, ...row }) => row) });
  }

  return {
    candidates,
    metrics: {
      activeContracts: active.length,
      tenantCandidates: [...tenantGroups.values()].length,
      ownerCandidates: [...ownerGroups.values()].length,
      propertyMatches: matchedProperties.size,
      autoSafe: candidates.filter((x) => x.candidateStatus === "auto_safe_candidate").length,
      requiresReview: candidates.filter((x) => x.candidateStatus === "requires_review").length,
      conflicts: candidates.filter((x) => x.candidateStatus === "conflict").length,
    },
  };
}

export async function persistClientReconciliationCohort(admin, cohort, actorProfileId) {
  if (!UUID.test(String(actorProfileId || ""))) throw new Error("invalid_actor");
  for (const candidate of cohort.candidates) {
    const row = {
      candidate_key: candidate.candidateKey, role_kind: candidate.roleKind, phone_digest: candidate.phoneDigest,
      candidate_status: candidate.candidateStatus, reason_code: candidate.reasonCode, source_count: candidate.sources.length,
    };
    const { data, error } = await admin.from("client_reconciliation_candidates").upsert(row, { onConflict: "candidate_key", ignoreDuplicates: false }).select("id").single();
    if (error) throw error;
    const sources = candidate.sources.map((source) => ({ candidate_id: data.id, source_type: source.sourceType, source_id: source.sourceId, matched_property_id: source.matchedPropertyId }));
    const { error: sourceError } = await admin.from("client_reconciliation_candidate_sources").upsert(sources, { onConflict: "source_type,source_id", ignoreDuplicates: true });
    if (sourceError) throw sourceError;
    const { error: auditError } = await admin.from("client_identity_audit").upsert({ candidate_id: data.id, event_type: "candidate_prepared", actor_profile_id: actorProfileId, context_ids: { roleKind: candidate.roleKind, sourceCount: candidate.sources.length, sourceTypes: [...new Set(candidate.sources.map((source) => source.sourceType))], sourceIds: candidate.sources.map((source) => source.sourceId), reasonCode: candidate.reasonCode, matchMethod: candidate.matchMethod } }, { ignoreDuplicates: true });
    if (auditError) throw auditError;
  }
  return cohort.metrics;
}
