import crypto from "node:crypto";
import {
  administrativeWorkR1Enabled,
  assertAdministrativeWorkR1Window,
  executeAdministrativeWorkR1,
} from "../../operaciones/durableAdministrativeWork.js";

const DOMAIN_CONFIG = Object.freeze({
  maintenance: {
    workType: "maintenance_followup",
    title: "Seguimiento administrativo de mantenimiento",
    nextStep: "Revisar la información recibida y el estado vigente del mantenimiento.",
  },
  payment: {
    workType: "payment_validation_followup",
    title: "Seguimiento administrativo de pago",
    nextStep: "Validar el pendiente financiero con una persona autorizada; no registrar ni confirmar pagos.",
  },
  administrative_pending: {
    workType: "administrative_followup",
    title: "Seguimiento administrativo pendiente",
    nextStep: "Revisar el estado vigente y definir el siguiente paso administrativo no financiero.",
  },
});

const TERMINAL = ["resolved", "cancelled"];
export const R1_CONFIDENCE_THRESHOLDS = Object.freeze({
  create_administrative_pending: 0.90,
  append_structured_internal_note: 0.90,
  link_received_evidence: 0.90,
  mark_information_received: 0.90,
  set_nonfinancial_next_step: 0.90,
  schedule_nonfinancial_follow_up: 0.90,
  mark_possible_duplicate: 0.90,
  assign_operational_responsible: 0.90,
});
const OPERATIONAL_MISSING = new Set(["maintenance_case", "physical_handover_confirmation", "contract_or_property", "administrative_pending", "erp_query", "attachment_interpretation"]);
const digest = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");
const one = (value) => Array.isArray(value) ? value[0] || null : value || null;

const querySingle = async (query) => {
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
};

export function administrativeWorkR1SourceEligible({ envelope, resolution, context, conversationAction = null, humanResponseId = null, env = process.env } = {}) {
  if (!administrativeWorkR1Enabled(env)) return { eligible: false, reason: "r1_disabled" };
  try { assertAdministrativeWorkR1Window(envelope?.occurredAt, env); }
  catch (error) { return { eligible: false, reason: String(error?.message || "r1_window_blocked") }; }
  if (String(envelope?.providerMetadata?.channelId || "") !== "544519") return { eligible: false, reason: "channel_not_allowlisted" };
  if (envelope?.direction !== "inbound") return { eligible: false, reason: "not_inbound" };
  if (humanResponseId) return { eligible: false, reason: "human_override" };
  if (!DOMAIN_CONFIG[resolution?.case_domain]) return { eligible: false, reason: "domain_not_allowlisted" };
  if (resolution?.identity_context?.status !== "trusted_link_available" || !context?.clientIdentityId) return { eligible: false, reason: "identity_not_confirmed" };
  if (!context?.contractId && !context?.propertyId) return { eligible: false, reason: "property_context_missing" };
  if (resolution?.conflict_detected || resolution?.technical_error) return { eligible: false, reason: "operational_context_unsafe" };
  if (resolution?.requires_human === true) return { eligible: false, reason: "requires_human" };
  if ((resolution?.missing_information || []).some((item) => OPERATIONAL_MISSING.has(String(item)))) return { eligible: false, reason: "operational_information_missing" };
  if (Number(resolution?.action_confidence || 0) < Math.min(...Object.values(R1_CONFIDENCE_THRESHOLDS))) return { eligible: false, reason: "r1_confidence_below_minimum" };
  if (resolution?.context_contradiction === true) return { eligible: false, reason: "context_contradiction" };
  if (resolution?.case_domain === "maintenance" && resolution?.domain_evidence?.maintenance !== true) return { eligible: false, reason: "maintenance_positive_evidence_required" };
  if (resolution?.case_status === "no_existing_case" && resolution?.domain_evidence?.maintenance !== true) return { eligible: false, reason: "unsupported_new_case_domain" };
  if (conversationAction && (conversationAction.requires_human === true || ["human_handoff", "no_message"].includes(conversationAction.conversation_action))) return { eligible: false, reason: "conversation_context_uncertain" };
  if (["internal_instruction_about_customer", "ambiguous_actor"].includes(resolution?.interaction_direction)) return { eligible: false, reason: "interaction_direction_blocked" };
  return { eligible: true, reason: null };
}

export function planAdministrativeWorkR1({ run, message, envelope, resolution, context, existingWork, currentPaymentState } = {}) {
  const config = DOMAIN_CONFIG[resolution.case_domain];
  const contextKey = [resolution.case_domain, context.clientIdentityId, context.contractId || "none", context.propertyId || "none", context.condominiumId || "none", context.unitId || "none"].join(":");
  const dedupeKey = `r1:${resolution.case_domain}:${digest(contextKey)}`;
  const sourceId = `msg:${digest(message?.external_message_id || message?.id)}`;
  const idempotencyKey = `ai:r1:${run.id}`;
  if (!existingWork) {
    const paymentAlreadyRecorded = resolution.case_domain === "payment" && currentPaymentState?.paymentRecorded === true;
    const commissionPending = resolution.case_domain === "payment" && resolution?.payment_state?.commission_status === "pending";
    const nextStep = paymentAlreadyRecorded && commissionPending
      ? "El pago ya aparece registrado. Verificar evidencia y responsable del seguimiento de comisión con revisión financiera humana; no asumir quién debe cubrirla."
      : config.nextStep;
    return {
      action: "create_administrative_pending", idempotencyKey, sourceOccurredAt: envelope.occurredAt,
      input: {
        domain: resolution.case_domain, workType: config.workType, title: config.title,
        dedupeKey, priority: resolution.requires_human ? "P1" : "P2",
        sourceType: "whatsapp", sourceId, sourceContextKey: contextKey.slice(0, 160),
        nextStep, requiresAuthorization: resolution.case_domain === "payment",
        clientIdentityId: context.clientIdentityId, contractId: context.contractId || null,
        propertyId: context.propertyId || null, condominiumId: context.condominiumId || null,
        unitId: context.unitId || null, responsibleArea: "Administración",
      },
    };
  }
  const interpreted = (envelope?.providerMetadata?.attachmentContext?.items || []).some((item) => item?.interpretation?.interpretationStatus === "completed");
  if (interpreted) return {
    action: "link_received_evidence", idempotencyKey, sourceOccurredAt: envelope.occurredAt,
    input: {
      workItemId: existingWork.id, evidenceType: "media_interpretation", referenceType: "shadow_message",
      referenceId: String(message.id), evidenceKey: `evidence:${digest(message.id)}`,
      summarySafe: "Se recibió evidencia multimedia con interpretación sanitizada disponible para revisión administrativa.",
    },
  };
  const paymentAlreadyRecorded = resolution.case_domain === "payment" && currentPaymentState?.paymentRecorded === true;
  return {
    action: "append_structured_internal_note", idempotencyKey, sourceOccurredAt: envelope.occurredAt,
    input: {
      workItemId: existingWork.id,
      note: paymentAlreadyRecorded
        ? "El registro financiero vigente ya refleja el pago. El trabajo permanece abierto únicamente para revisar el pendiente administrativo de comisión con evidencia verificable y sin asumir responsable."
        : "Se recibió nueva información. Se reconsultó el estado canónico y el trabajo continúa abierto para seguimiento administrativo.",
    },
  };
}

export async function reconsultAdministrativeWorkR1State(admin, { context, resolution, dedupeKey }) {
  const identity = await querySingle(admin.from("client_identities").select("id").eq("id", context.clientIdentityId));
  if (!identity) throw new Error("r1_identity_no_longer_available");
  let contract = null; let property = null;
  if (context.contractId) contract = await querySingle(admin.from("contracts").select("id,tenant_client_id,property_id,status").eq("id", context.contractId));
  if (context.propertyId) property = await querySingle(admin.from("properties").select("id,owner_client_id").eq("id", context.propertyId));
  if (context.contractId && !contract) throw new Error("r1_contract_no_longer_available");
  if (context.propertyId && !property) throw new Error("r1_property_no_longer_available");
  if (contract?.property_id && context.propertyId && contract.property_id !== context.propertyId) throw new Error("r1_property_context_changed");
  const identityMatches = contract?.tenant_client_id === context.clientIdentityId || property?.owner_client_id === context.clientIdentityId;
  if (!identityMatches) throw new Error("r1_identity_context_changed");
  const existingWork = await querySingle(admin.from("administrative_work_items").select("id,status,dedupe_key").eq("dedupe_key", dedupeKey));
  let currentPaymentState = null;
  if (resolution.case_domain === "payment" && context.contractId) {
    const { data, error } = await admin.from("payments").select("id,status").eq("contract_id", context.contractId).limit(20);
    if (error) throw error;
    currentPaymentState = { paymentRecorded: (data || []).some((row) => ["paid", "pagado", "confirmed", "registrado"].includes(String(row.status || "").toLowerCase())) };
  }
  return { existingWork, currentPaymentState };
}

export async function maybeExecuteAdministrativeWorkR1({ admin, run, message, envelope, resolution, context, conversationAction = null, humanResponseId = null, env = process.env, reconsult = reconsultAdministrativeWorkR1State, execute = executeAdministrativeWorkR1 } = {}) {
  const gate = administrativeWorkR1SourceEligible({ envelope, resolution, context, conversationAction, humanResponseId, env });
  if (!gate.eligible) return { status: "blocked", reason: gate.reason, action: null };
  const contextKey = [resolution.case_domain, context.clientIdentityId, context.contractId || "none", context.propertyId || "none", context.condominiumId || "none", context.unitId || "none"].join(":");
  const dedupeKey = `r1:${resolution.case_domain}:${digest(contextKey)}`;
  const state = await reconsult(admin, { context, resolution, dedupeKey });
  if (state.existingWork && TERMINAL.includes(state.existingWork.status)) return { status: "blocked", reason: "current_state_already_terminal", action: null };
  const plan = planAdministrativeWorkR1({ run, message, envelope, resolution, context, ...state });
  if (Number(resolution?.action_confidence || 0) < Number(R1_CONFIDENCE_THRESHOLDS[plan.action] || 1)) return { status: "blocked", reason: "action_confidence_below_threshold", action: null };
  const result = await execute(admin, { ...plan, actorType: "ai", actorProfileId: null }, env);
  return { status: result?.idempotent ? "idempotent" : "executed", action: plan.action, workItemId: result?.workItemId || null, windowActionCount: Number(result?.windowActionCount || 0), hardCap: Number(result?.hardCap || 20) };
}
