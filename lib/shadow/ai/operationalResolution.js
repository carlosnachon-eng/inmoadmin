import { buildEvidenceLedger } from "./grounding.js";
import { buildResolvedOperationalContext } from "./operationalContext.js";

export const SHADOW_OPERATIONAL_RESOLUTION_VERSION = "shadow-operational-resolution-v1";

const DOMAIN_BY_INTENT = Object.freeze({
  mantenimiento: "maintenance",
  pago_renta: "payment",
  servicio: "payment",
  no_determinado: "administrative_pending",
});

const relevantToolNames = Object.freeze({
  maintenance: new Set(["get_maintenance_ticket_summary"]),
  payment: new Set(["get_payment_summary", "get_service_period_status"]),
  administrative_pending: new Set(["get_work_center_case"]),
});

const identityKeys = Object.freeze({
  maintenance: ["ticketId", "propertyId"],
  payment: ["paymentId", "contractId", "serviceId", "propertyId"],
  administrative_pending: ["workCenterContextKey", "propertyId"],
});

const safeEntity = (row) => ({
  entity_type: String(row.entityType || "record").slice(0, 60),
  internal_id: String(row.internalId || row.id || row.contextKey || "").slice(0, 120),
  status: row.status == null ? null : String(row.status).slice(0, 80),
});

const completedInterpretations = (envelope) => (envelope?.providerMetadata?.attachmentContext?.items || [])
  .map((item) => item?.interpretation)
  .filter((item) => item?.interpretationStatus === "completed");

const visualAmounts = (envelope) => completedInterpretations(envelope)
  .map((item) => Number(item?.extractedFields?.amount))
  .filter(Number.isFinite);

function paymentAssessment(rows, envelope) {
  if (!rows.length) return { status: "record_not_found", missing: ["obligation_or_payment_record"], conflict: false };
  const amounts = visualAmounts(envelope);
  if (!amounts.length) return { status: rows.length > 1 ? "multiple_records" : "record_found", missing: [], conflict: false };
  const erpAmounts = rows.map((row) => Number(row.amount)).filter(Number.isFinite);
  const coincides = amounts.some((amount) => erpAmounts.some((expected) => expected === amount));
  return { status: coincides ? "apparent_amount_match" : "amount_conflict", missing: [], conflict: !coincides };
}

function maintenanceAssessment(rows) {
  if (!rows.length) return { status: "no_existing_case", missing: ["maintenance_case"], conflict: false };
  const open = rows.filter((row) => !["cerrado", "cancelado", "terminado", "resuelto"].includes(String(row.status || "").toLowerCase()));
  if (open.length > 1) return { status: "possible_duplicate", missing: [], conflict: false };
  return { status: open.length ? "existing_open_case" : "existing_closed_case", missing: [], conflict: false };
}

function pendingAssessment(rows) {
  if (!rows.length) return { status: "pending_not_found", missing: ["administrative_pending"], conflict: false };
  const row = rows[0];
  if (!row.responsibleId) return { status: String(row.status || "pending"), missing: ["responsible"], conflict: false };
  return { status: String(row.status || "pending"), missing: [], conflict: false };
}

export function buildShadowOperationalResolution({ decision, envelope, tools = [] } = {}) {
  const caseDomain = DOMAIN_BY_INTENT[decision?.intent] || "outside_phase_3a";
  const context = buildResolvedOperationalContext({ metadata: envelope?.providerMetadata || {}, resolvedEntities: decision?.resolvedEntities || [], toolResults: tools });
  const relevant = tools.filter((tool) => relevantToolNames[caseDomain]?.has(tool.name));
  const failed = relevant.some((tool) => !tool.ok);
  const rows = relevant.filter((tool) => tool.ok).flatMap((tool) => tool.result || []);
  const hasIdentity = (identityKeys[caseDomain] || []).some((key) => Boolean(context[key]));
  const interpretationFailed = envelope?.providerMetadata?.attachmentContext?.present === true
    && envelope?.providerMetadata?.attachmentContext?.interpreted !== true;

  let assessment = { status: "outside_phase_3a", missing: [], conflict: false };
  if (caseDomain !== "outside_phase_3a" && !hasIdentity) assessment = { status: "insufficient_identity_context", missing: ["trusted_identity_link"], conflict: false };
  else if (failed) assessment = { status: "technical_error", missing: ["erp_query"], conflict: false };
  else if (caseDomain === "maintenance") assessment = maintenanceAssessment(rows);
  else if (caseDomain === "payment") assessment = paymentAssessment(rows, envelope);
  else if (caseDomain === "administrative_pending") assessment = pendingAssessment(rows);

  const evidence = buildEvidenceLedger(relevant);
  const insufficient = assessment.missing.length > 0 || interpretationFailed;
  const requiresHuman = caseDomain === "outside_phase_3a" || !hasIdentity || failed || assessment.conflict || insufficient
    || caseDomain === "payment" || assessment.status === "possible_duplicate" || Boolean(decision?.responseBlocked);
  const informationallyResolved = (
    (caseDomain === "maintenance" && ["existing_open_case", "existing_closed_case"].includes(assessment.status))
    || (caseDomain === "administrative_pending" && rows.length === 1 && !assessment.missing.length)
  );
  const wouldResolve = Boolean(informationallyResolved && evidence.length && !requiresHuman);

  const proposedAction = assessment.status === "insufficient_identity_context"
    ? "Solicitar una sola referencia que permita vincular el caso con un registro de InmoAdmin."
    : assessment.status === "no_existing_case"
      ? "Revisión humana para decidir si corresponde crear un ticket; Shadow no lo crea."
      : assessment.status === "possible_duplicate"
        ? "Revisar los tickets abiertos relacionados antes de crear o modificar cualquier caso."
        : assessment.status === "apparent_amount_match"
          ? "Validar financieramente el posible comprobante contra la obligación; no confirmar el pago."
          : assessment.status === "amount_conflict"
            ? "Revisión financiera por diferencia entre el monto visual y el registro operativo."
            : assessment.status === "technical_error"
              ? "Revisión humana porque la consulta read-only no pudo completarse."
              : "Informar el estado verificado y proponer seguimiento, sin ejecutar acciones.";

  return {
    resolution_version: SHADOW_OPERATIONAL_RESOLUTION_VERSION,
    case_domain: caseDomain,
    case_status: assessment.status,
    identified_entities: rows.map(safeEntity).filter((item) => item.internal_id).slice(0, 10),
    evidence,
    proposed_action: proposedAction,
    action_confidence: evidence.length && !failed && !assessment.conflict ? Math.min(Number(decision?.confidence || 0), 0.9) : Math.min(Number(decision?.confidence || 0), 0.4),
    requires_human: requiresHuman,
    human_reason: requiresHuman ? (assessment.status === "insufficient_identity_context" ? "insufficient_identity_context" : assessment.status) : null,
    missing_information: [...new Set([...assessment.missing, ...(interpretationFailed ? ["attachment_interpretation"] : [])])],
    would_resolve_without_human: wouldResolve,
    automation_candidate_reason: wouldResolve ? "grounded_informational_resolution" : (requiresHuman ? (assessment.status || "human_review") : "not_actionable"),
    identity_context: { status: hasIdentity ? "trusted_link_available" : "insufficient_identity_context", identifier_keys: (identityKeys[caseDomain] || []).filter((key) => Boolean(context[key])) },
    conflict_detected: assessment.conflict,
    technical_error: failed,
  };
}

export function shadowOperationalMetrics(resolution) {
  return {
    case_domain: resolution.case_domain,
    would_resolve_without_human: resolution.would_resolve_without_human,
    requires_human: resolution.requires_human,
    missing_identity: resolution.human_reason === "insufficient_identity_context",
    missing_information: resolution.missing_information.length > 0,
    data_conflict: resolution.conflict_detected,
    technical_error: resolution.technical_error,
  };
}
