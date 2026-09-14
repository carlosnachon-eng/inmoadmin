import crypto from "node:crypto";
import { exactPhoneCandidateRef } from "./exactPhoneReadOnlyEvaluator.js";
import { EXACT_PHONE_VALIDATED_CANDIDATE_REFS } from "./exactPhoneValidatedRefs.js";

const SAFE_IDENTITY_SOURCES = new Set(["exact_phone_unique", "manual_admin_review", "erp_structured_link"]);
const VALID_STATES = new Set(["confirmed", "candidate"]);
const opaqueRef = (namespace, value) => value
  ? crypto.createHash("sha256").update(`${namespace}:${String(value)}`).digest("hex").slice(0, 12)
  : null;

const toolRows = (run) => (Array.isArray(run?.tool_results_json) ? run.tool_results_json : [])
  .filter((tool) => tool?.name === "resolve_contact_identity" && tool?.ok === true && Array.isArray(tool.result))
  .flatMap((tool) => tool.result);

function identityAttribution(run, cohort) {
  const rows = toolRows(run);
  const identities = rows.filter((row) => row?.entityType === "contact_identity");
  const resolvedByKey = new Map(identities
    .filter((row) => row?.resolved === true && VALID_STATES.has(row?.status) && row?.internalId)
    .map((row) => [`${row.internalId}:${row.linkId || ""}:${row.status}`, row]));
  const resolved = [...resolvedByKey.values()];
  if (resolved.length !== 1) {
    return {
      attribution: "unattributed",
      identityState: "unresolved",
      canonicalIdentityRef: null,
      resolutionSource: null,
      exactPhone7of7Ref: null,
      inExactPhone7of7: false,
      propertyResolved: false,
      relationshipResolved: false,
      attributionReason: resolved.length > 1 ? "conflicting_resolution_evidence" : identities.length ? "identity_unresolved" : "resolution_evidence_missing",
    };
  }

  const identity = resolved[0];
  const source = SAFE_IDENTITY_SOURCES.has(identity.linkSource) ? identity.linkSource : "structured_link_other";
  const exactRef = identity.linkId && identity.linkSource === "exact_phone_unique" ? exactPhoneCandidateRef(identity.linkId) : null;
  const properties = rows.filter((row) => row?.entityType === "property" && row?.method === "confirmed_identity_link" && row?.internalId);
  const contracts = [...new Map(rows
    .filter((row) => row?.entityType === "contract" && row?.method === "confirmed_identity_link" && row?.internalId && row?.active === true)
    .map((row) => [row.internalId, row])).values()];
  const propertyIds = new Set(properties.map((row) => row.internalId));
  const contractPropertyIds = new Set(contracts.map((row) => row.propertyId).filter(Boolean));
  const propertyResolved = propertyIds.size === 1 && identity.ambiguousPropertyContext !== true;
  const relationshipResolved = propertyResolved && (contracts.length === 0 || (contracts.length === 1 && (!contractPropertyIds.size || contractPropertyIds.has([...propertyIds][0]))));

  return {
    attribution: "attributed",
    identityState: identity.status,
    canonicalIdentityRef: opaqueRef("canonical_identity", identity.internalId),
    resolutionSource: source,
    exactPhone7of7Ref: exactRef && cohort.has(exactRef) ? exactRef : null,
    inExactPhone7of7: Boolean(exactRef && cohort.has(exactRef)),
    propertyResolved,
    relationshipResolved,
    attributionReason: null,
  };
}

export function buildShadowRunIdentityObservability({ runs = [], decisions = [], actions = [], cohortRefs = EXACT_PHONE_VALIDATED_CANDIDATE_REFS } = {}) {
  const cohort = new Set(cohortRefs);
  const decisionsByRun = new Map();
  const actionsByRun = new Map();
  for (const row of decisions) if (!decisionsByRun.has(row.ai_run_id)) decisionsByRun.set(row.ai_run_id, row);
  for (const row of actions) if (!actionsByRun.has(row.ai_run_id)) actionsByRun.set(row.ai_run_id, row);
  return runs.map((run) => {
    const decision = decisionsByRun.get(run.id) || null;
    const action = actionsByRun.get(run.id) || null;
    return {
      runId: run.id,
      runRef: opaqueRef("shadow_run", run.id),
      createdAt: run.created_at || run.started_at || null,
      ...identityAttribution(run, cohort),
      action3B: action?.conversation_action || null,
      blocker: action?.blocked_reason || decision?.escalation_reason || run?.error_sanitized || null,
      requiresHuman: action ? Boolean(action.requires_human) : decision ? Boolean(decision.requires_human) : null,
      autoSendEligible: action ? Boolean(action.auto_send_eligible) : null,
    };
  });
}
