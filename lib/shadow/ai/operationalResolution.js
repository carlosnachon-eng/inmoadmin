import { buildEvidenceLedger } from "./grounding.js";
import { buildResolvedOperationalContext } from "./operationalContext.js";
import { classifyInteractionDirection } from "./interactionDirection.js";
import { deriveIdentityIndependentContext } from "./identityIndependentPolicy.js";

export const SHADOW_OPERATIONAL_RESOLUTION_VERSION = "shadow-operational-resolution-v5";

const DOMAIN_BY_INTENT = Object.freeze({
  mantenimiento: "maintenance",
  entrega_inmueble: "property_handover",
  pago_renta: "payment",
  servicio: "payment",
  no_determinado: "administrative_pending",
});

const relevantToolNames = Object.freeze({
  maintenance: new Set(["resolve_contact_identity", "get_maintenance_ticket_summary"]),
  payment: new Set(["resolve_contact_identity", "get_payment_summary", "get_service_period_status"]),
  administrative_pending: new Set([
    "resolve_contact_identity", "get_work_center_case", "list_administrative_work",
    "get_administrative_work", "find_administrative_work_by_context", "find_possible_duplicate_work",
    "get_administrative_work_history", "get_administrative_evidence_summary", "get_pending_approvals",
  ]),
  property_handover: new Set(["resolve_contact_identity"]),
});

const identityKeys = Object.freeze({
  maintenance: ["ticketId", "propertyId"],
  payment: ["paymentId", "contractId", "serviceId", "propertyId"],
  administrative_pending: ["workCenterContextKey", "propertyId"],
  property_handover: ["contractId", "propertyId"],
});

const POSITIVE_MAINTENANCE = /\b(?:aver[ií]a|fuga|inundaci[oó]n|humedad|da[ñn]o|reparaci[oó]n|mantenimiento|t[eé]cnico|proveedor|cotizaci[oó]n|desperfecto|pieza\s+hidr[aá]ulica)\b/i;
const POSITIVE_HANDOVER = /\b(?:entrega(?:r|do|da)?\s+(?:del\s+)?(?:departamento|depa|inmueble)|entreg(?:u[eé]|ar|a)\s+(?:las?\s+)?(?:llaves|tarjetas)|desocup(?:ar|aci[oó]n)|fecha\s+de\s+entrega|llaves\s*,?\s*tarjetas|inspecci[oó]n\s+de\s+salida|cierre\s+de\s+ocupaci[oó]n)\b/i;
const combinedConversationText = (envelope) => [...(envelope?.providerMetadata?.priorConversation || []).map((item) => item?.sanitizedText), envelope?.sanitizedText].filter(Boolean).join("\n");
export const hasPositiveMaintenanceEvidence = ({ envelope, tools = [] } = {}) => POSITIVE_MAINTENANCE.test(combinedConversationText(envelope))
  || tools.some((tool) => tool?.ok && tool.name === "get_maintenance_ticket_summary" && (tool.result || []).length > 0)
  || completedInterpretations(envelope).some((item) => /maintenance|damage|hydraulic|fuga|humedad/i.test(String(item?.category || "")));
export const hasPositivePropertyHandoverEvidence = (envelope) => POSITIVE_HANDOVER.test(combinedConversationText(envelope));

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
const SENSITIVE_MAINTENANCE = /(?:\$\s*\d|\b(?:mxn|usd)\s*\d|\b(?:costo|cost[oó]|precio|importe|total|ticket\s+de\s+compra|recibo\s+de\s+compra|comprobante\s+de\s+compra|compr[eéó]|se\s+compr[oó]|reembols(?:o|ar)|devoluci[oó]n\s+del\s+(?:dinero|gasto)|qui[eé]n\s+(?:lo\s+)?paga|a\s+qui[eé]n\s+le\s+corresponde\s+pagar|responsabilidad|responsable\s+de\s+pagar|autoriza(?:r|ci[oó]n)\s+(?:el\s+)?gasto|gasto\s+autorizado)\b)/i;
export const hasSensitiveMaintenanceEvidence = (envelope) => {
  if (SENSITIVE_MAINTENANCE.test(combinedConversationText(envelope))) return true;
  return completedInterpretations(envelope).some((item) => {
    const amount = item?.extractedFields?.amount;
    const interpretationText = `${item?.category || ""} ${item?.summary || ""} ${item?.reviewReason || ""}`;
    return item?.category === "possible_payment_receipt"
      || (amount !== null && amount !== undefined && amount !== "" && Number.isFinite(Number(amount)))
      || SENSITIVE_MAINTENANCE.test(interpretationText);
  });
};

const PAYMENT_STATUS = Object.freeze(["pending", "partial", "paid"]);
const PAYMENT_DESTINATIONS = Object.freeze(["owner", "emporio", "multiple_authorized_destinations", "unknown"]);
const COMMISSION_STATUS = Object.freeze(["pending", "apparently_covered"]);
const normalizeStatus = (value) => String(value || "").trim().toLowerCase();
const attachmentItems = (envelope) => envelope?.providerMetadata?.attachmentContext?.items || [];
const paymentDocumentMentioned = (text) => /\b(?:env[ií]o|envi[eé]|comparto|mand[éeo]|adjunt[éeo]|aqu[ií]\s+est[aá]).{0,80}\b(?:comprobante|recibo|transferencia|dep[oó]sito|pago)\b/i.test(String(text || ""));
const financialSensitivity = (text) => {
  const value = String(text || "");
  return /\b(?:comisi[oó]n|renovaci[oó]n|pago\s+parcial|transferencias?\s+(?:separadas?|m[uú]ltiples?)|propietari[oa].{0,50}emporio|emporio.{0,50}propietari[oa]|doble\s+cobro|devoluci[oó]n|dep[oó]sito|negociaci[oó]n|cobranza)\b/i.test(value);
};

function documentContext(envelope) {
  const items = attachmentItems(envelope);
  const attachmentPresent = envelope?.providerMetadata?.attachmentContext?.present === true || items.length > 0 || /\[(?:IMAGEN|DOCUMENTO|ARCHIVO)\]/i.test(String(envelope?.sanitizedText || ""));
  const completed = items.some((item) => item?.interpretation?.interpretationStatus === "completed");
  const mentionedAsSent = paymentDocumentMentioned(envelope?.sanitizedText);
  return { attachment_present: attachmentPresent, completed_interpretation: completed, mentioned_as_sent: mentionedAsSent, equivalent_document_present: attachmentPresent || completed || mentionedAsSent };
}

function administrativeObligationStatus(rows) {
  const explicit = rows.map((row) => normalizeStatus(row.administrativeObligationStatus || row.obligationStatus || row.status));
  if (explicit.some((value) => ["partial", "parcial", "partially_paid"].includes(value))) return "partial";
  const expected = rows.map((row) => Number(row.expectedAmount ?? row.amountExpected)).filter(Number.isFinite).reduce((a, b) => a + b, 0);
  const paid = rows.map((row) => Number(row.paidAmount ?? row.amountPaid)).filter(Number.isFinite).reduce((a, b) => a + b, 0);
  if (expected > 0 && paid > 0 && paid < expected) return "partial";
  if ((expected > 0 && paid >= expected) || explicit.some((value) => ["paid", "pagado", "cubierto"].includes(value))) return "paid";
  return "pending";
}

function paymentDestination(rows) {
  const destinations = new Set(rows.map((row) => normalizeStatus(row.paymentDestination || row.destination)).filter((value) => ["owner", "propietario", "emporio"].includes(value)).map((value) => value === "propietario" ? "owner" : value));
  if (destinations.size > 1) return "multiple_authorized_destinations";
  const value = [...destinations][0] || "unknown";
  return PAYMENT_DESTINATIONS.includes(value) ? value : "unknown";
}

function commissionStatus(rows) {
  const values = rows.map((row) => normalizeStatus(row.commissionStatus));
  return values.some((value) => ["apparently_covered", "aparentemente_cubierta", "covered", "confirmed"].includes(value)) ? "apparently_covered" : "pending";
}

function paymentAssessment(rows, envelope) {
  if (!rows.length) return { status: "record_not_found", missing: ["obligation_or_payment_record"], conflict: false };
  const amounts = visualAmounts(envelope);
  if (!amounts.length) return { status: rows.length > 1 ? "multiple_records" : "pending_bank_confirmation", missing: [], conflict: false };
  const erpAmounts = rows.map((row) => Number(row.amount)).filter(Number.isFinite);
  const coincides = amounts.some((amount) => erpAmounts.some((expected) => expected === amount));
  return { status: coincides ? "pending_bank_confirmation" : "amount_conflict", missing: [], conflict: !coincides };
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
  const handoverEvidence = hasPositivePropertyHandoverEvidence(envelope);
  const maintenanceEvidence = hasPositiveMaintenanceEvidence({ envelope, tools });
  const effectiveIntent = handoverEvidence && !maintenanceEvidence ? "entrega_inmueble" : decision?.intent;
  const caseDomain = DOMAIN_BY_INTENT[effectiveIntent] || "outside_phase_3a";
  const context = buildResolvedOperationalContext({ metadata: envelope?.providerMetadata || {}, resolvedEntities: decision?.resolvedEntities || [], toolResults: tools });
  const relevant = tools.filter((tool) => relevantToolNames[caseDomain]?.has(tool.name));
  const identityRows = relevant.filter((tool) => tool.name === "resolve_contact_identity" && tool.ok).flatMap((tool) => tool.result || []);
  const resolvedIdentity = identityRows.find((row) => row.entityType === "contact_identity" && row.resolved === true);
  const unresolvedIdentity = identityRows.find((row) => row.entityType === "contact_identity" && row.resolved === false);
  const failed = relevant.some((tool) => !tool.ok);
  const rows = relevant.filter((tool) => tool.ok && tool.name !== "resolve_contact_identity").flatMap((tool) => tool.result || []);
  const hasOperationalEntity = (identityKeys[caseDomain] || []).some((key) => Boolean(context[key]));
  const hasIdentity = Boolean(resolvedIdentity || (!unresolvedIdentity && hasOperationalEntity));
  const interpretationFailed = envelope?.providerMetadata?.attachmentContext?.present === true
    && envelope?.providerMetadata?.attachmentContext?.interpreted !== true;
  const interactionDirection = classifyInteractionDirection({ envelope, identityRoles: resolvedIdentity?.roles || [] });

  let assessment = { status: "outside_phase_3a", missing: [], conflict: false };
  if (caseDomain !== "outside_phase_3a" && !hasIdentity) assessment = { status: "insufficient_identity_context", missing: ["trusted_identity_link"], conflict: false };
  else if (caseDomain !== "outside_phase_3a" && !hasOperationalEntity) assessment = { status: "insufficient_property_context", missing: ["contract_or_property"], conflict: false };
  else if (failed) assessment = { status: "technical_error", missing: ["erp_query"], conflict: false };
  else if (caseDomain === "maintenance") assessment = maintenanceAssessment(rows);
  else if (caseDomain === "payment") assessment = paymentAssessment(rows, envelope);
  else if (caseDomain === "administrative_pending") assessment = pendingAssessment(rows);
  else if (caseDomain === "property_handover") assessment = { status: "handover_pending_confirmation", missing: ["physical_handover_confirmation"], conflict: false };

  const evidence = buildEvidenceLedger(relevant);
  const documents = documentContext(envelope);
  const commissionReferenceMissing = caseDomain === "administrative_pending"
    && documents.equivalent_document_present
    && /\b(?:comprobante|pago)\b[\s\S]{0,100}\b(?:administraci[oó]n|comisi[oó]n)\b/i.test(String(envelope?.sanitizedText || ""))
    && !/\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|20\d{2}|periodo|contrato|propiedad|unidad)\b/i.test(String(envelope?.sanitizedText || ""));
  const paymentState = caseDomain === "payment" ? {
    evidence_received: documents.equivalent_document_present,
    administrative_obligation_status: administrativeObligationStatus(rows),
    bank_reconciliation_status: documents.equivalent_document_present ? "pending_confirmation" : "not_checked",
    payment_destination: paymentDestination(rows),
    commission_status: commissionStatus(rows),
  } : null;
  if (paymentState && !PAYMENT_STATUS.includes(paymentState.administrative_obligation_status)) paymentState.administrative_obligation_status = "pending";
  if (paymentState && !COMMISSION_STATUS.includes(paymentState.commission_status)) paymentState.commission_status = "pending";
  const effectiveMissing = [...new Set([...assessment.missing, ...(interpretationFailed ? ["attachment_interpretation"] : []), ...(commissionReferenceMissing ? ["commission_reference"] : [])])];
  const sensitiveMaintenance = caseDomain === "maintenance" && hasSensitiveMaintenanceEvidence(envelope);
  const identityIndependentContext = !hasIdentity && interactionDirection === "inbound_customer_action"
    ? deriveIdentityIndependentContext({ caseDomain, text: envelope?.sanitizedText, documentPresent: documents.equivalent_document_present, sensitiveComponent: sensitiveMaintenance, missingInformation: effectiveMissing })
    : deriveIdentityIndependentContext();
  const insufficient = effectiveMissing.length > 0;
  const actorRequiresHuman = ["internal_instruction_about_customer", "ambiguous_actor"].includes(interactionDirection);
  const requiresHuman = caseDomain === "outside_phase_3a" || !hasIdentity || failed || assessment.conflict || insufficient || actorRequiresHuman
    || caseDomain === "payment" || caseDomain === "property_handover" || sensitiveMaintenance
    || assessment.status === "possible_duplicate" || Boolean(decision?.responseBlocked);
  const informationallyResolved = (
    (caseDomain === "maintenance" && ["existing_open_case", "existing_closed_case"].includes(assessment.status))
    || (caseDomain === "administrative_pending" && rows.length === 1 && !assessment.missing.length)
  );
  const wouldResolve = Boolean(informationallyResolved && evidence.length && !requiresHuman && interactionDirection === "inbound_customer_action");

  const proposedAction = interactionDirection === "internal_instruction_about_customer"
    ? "Registrar seguimiento administrativo pendiente hacia un tercero; no responder al autor ni ejecutar cobranza."
    : assessment.status === "insufficient_identity_context"
    ? "Solicitar una sola referencia que permita vincular el caso con un registro de InmoAdmin."
    : assessment.status === "no_existing_case"
      ? "Revisión humana para decidir si corresponde crear un ticket; Shadow no lo crea."
      : assessment.status === "possible_duplicate"
        ? "Revisar los tickets abiertos relacionados antes de crear o modificar cualquier caso."
        : assessment.status === "apparent_amount_match"
          ? "Validar financieramente el posible comprobante contra la obligación; no confirmar el pago."
          : assessment.status === "pending_bank_confirmation"
            ? "La coincidencia es sólo administrativa; mantener pendiente de confirmación bancaria humana."
          : assessment.status === "amount_conflict"
            ? "Revisión financiera por diferencia entre el monto visual y el registro operativo."
            : assessment.status === "technical_error"
              ? "Revisión humana porque la consulta read-only no pudo completarse."
              : "Informar el estado verificado y proponer seguimiento, sin ejecutar acciones.";

  return {
    resolution_version: SHADOW_OPERATIONAL_RESOLUTION_VERSION,
    interaction_direction: interactionDirection,
    case_domain: caseDomain,
    effective_intent: effectiveIntent,
    case_status: assessment.status,
    identified_entities: rows.map(safeEntity).filter((item) => item.internal_id).slice(0, 10),
    evidence,
    proposed_action: proposedAction,
    action_confidence: evidence.length && !failed && !assessment.conflict ? Math.min(Number(decision?.confidence || 0), 0.9) : Math.min(Number(decision?.confidence || 0), 0.4),
    requires_human: requiresHuman,
    human_reason: requiresHuman ? (decision?.responseBlocked === true
      ? String(decision?.groundingReason || "actor_role_grounding_blocked").slice(0, 80)
      : assessment.status === "insufficient_identity_context"
        ? "insufficient_identity_context"
        : sensitiveMaintenance ? "sensitive_maintenance_cost_or_responsibility" : assessment.status) : null,
    missing_information: effectiveMissing,
    would_resolve_without_human: wouldResolve,
    automation_candidate_reason: wouldResolve ? "grounded_informational_resolution" : (requiresHuman ? (assessment.status || "human_review") : "not_actionable"),
    identity_context: { status: hasIdentity ? (hasOperationalEntity ? "trusted_link_available" : "insufficient_property_context") : "insufficient_identity_context", client_identity_id: context.clientIdentityId || null, roles: resolvedIdentity?.roles || [], identifier_keys: (identityKeys[caseDomain] || []).filter((key) => Boolean(context[key])) },
    conflict_detected: assessment.conflict,
    technical_error: failed,
    domain_evidence: { maintenance: maintenanceEvidence, property_handover: handoverEvidence },
    context_contradiction: decision?.intent === "mantenimiento" && handoverEvidence && !maintenanceEvidence,
    document_context: documents,
    payment_state: paymentState,
    sensitive_financial_case: caseDomain === "payment" && financialSensitivity(envelope?.sanitizedText),
    sensitive_maintenance_case: sensitiveMaintenance,
    identity_independent_context: identityIndependentContext,
    operational_follow_up: interactionDirection === "internal_instruction_about_customer" ? {
      type: "third_party_administrative_follow_up", status: "pending_human_authorization", executable: false,
    } : sensitiveMaintenance || identityIndependentContext?.sensitive_internal_handoff === true ? {
      type: "sensitive_internal_handoff", status: "pending_human_review", executable: false,
      reason: "cost_and_responsibility_require_human_review",
    } : null,
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
