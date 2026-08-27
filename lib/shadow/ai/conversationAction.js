export const SHADOW_CONVERSATION_ACTION_VERSION = "shadow-conversation-action-v1";
export const SHADOW_CONVERSATION_ACTIONS = Object.freeze([
  "ask_missing_information", "request_document", "clarify_property", "clarify_payment_amount",
  "clarify_payment_period", "acknowledge_received_information", "provide_verified_status",
  "human_handoff", "no_message",
]);
export const SHADOW_CONVERSATION_ACTION_STATUSES = Object.freeze([
  "proposed", "approved_for_future_auto", "superseded", "expired", "rejected", "sent",
]);
export const SHADOW_CONVERSATION_DOMAINS = Object.freeze(["maintenance", "payment", "administrative_pending"]);
export const SHADOW_CONVERSATION_MESSAGE_MAX = 480;
export const SHADOW_CONVERSATION_ACTION_TTL_MS = 24 * 60 * 60 * 1000;

const SENSITIVE_DOMAINS = new Set(["juridico_conflicto", "devolucion_deposito", "propietario_liquidacion"]);
const FORBIDDEN_SEMANTICS = [
  /pago\s+(?:est[aá]\s+)?confirmad[oa]/i, /ya\s+recibimos\s+(?:tu|su)\s+pago/i, /saldo\s+liquidad[oa]/i,
  /autorizamos\s+(?:la\s+)?reparaci[oó]n/i, /propietari[oa]\s+autoriz[oó]/i,
  /proveedor\s+(?:ir[aá]|va\s+a\s+ir|acudir[aá]).*(?:hora|hoy|mañana|\d{1,2}:\d{2})/i,
  /contrato\s+aprobad[oa]/i, /devoluci[oó]n\s+autorizad[oa]/i,
  /(?:es|ser[aá])\s+responsabilidad\s+(?:legal|del\s+propietario|del\s+inquilino)/i,
  /(?:demanda|embargo|desalojo|acci[oó]n\s+legal)/i,
];
const EXCESSIVE_PII = /(?:\b\d{10,}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/)/i;
const clean = (value, max = 160) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const evidenceRefs = (resolution) => [...new Set((resolution?.evidence || []).map((item) => clean(item?.evidenceId, 180)).filter(Boolean))].slice(0, 20);
const propertyOptions = (resolution) => (resolution?.property_options || resolution?.identity_context?.property_options || [])
  .map((item) => clean(item?.display_name || item?.name || item, 80)).filter(Boolean).slice(0, 4);

export function conversationActionCapabilities(env = process.env) {
  return {
    enabled: env.SHADOW_CONVERSATION_ACTIONS_ENABLED === "true",
    adminOutboundEnabled: env.SHADOW_ADMIN_OUTBOUND_ENABLED === "true",
  };
}

export function assertConversationActionShadowMode(env = process.env) {
  const capabilities = conversationActionCapabilities(env);
  if (!capabilities.enabled) throw new Error("conversation_actions_disabled");
  if (capabilities.adminOutboundEnabled || env.SHADOW_OUTBOUND_ENABLED === "true") throw new Error("conversation_action_outbound_blocked");
  return capabilities;
}

export function validateConversationAction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_conversation_action_shape");
  if (!SHADOW_CONVERSATION_DOMAINS.includes(value.case_domain)) throw new Error("invalid_conversation_action_domain");
  if (!SHADOW_CONVERSATION_ACTIONS.includes(value.conversation_action)) throw new Error("invalid_conversation_action_enum");
  if (typeof value.auto_send_eligible !== "boolean" || typeof value.requires_human !== "boolean") throw new Error("invalid_conversation_action_shape");
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error("invalid_conversation_action_confidence");
  return value;
}

function chooseAction(resolution, decision) {
  const domain = resolution?.case_domain;
  const missing = new Set(resolution?.missing_information || []);
  if (!SHADOW_CONVERSATION_DOMAINS.includes(domain) || SENSITIVE_DOMAINS.has(decision?.intent)) return "no_message";
  if (resolution?.identity_context?.status !== "trusted_link_available") return resolution?.case_status === "insufficient_property_context" ? "clarify_property" : "human_handoff";
  if (resolution?.technical_error) return "human_handoff";
  if (domain === "payment" && resolution?.case_status === "amount_conflict") return "clarify_payment_amount";
  if (resolution?.conflict_detected) return "human_handoff";
  if (domain === "maintenance") {
    if (missing.has("attachment_interpretation") || missing.has("maintenance_photo")) return "request_document";
    if (missing.has("location") || missing.has("maintenance_case")) return "ask_missing_information";
    if (["existing_open_case", "existing_closed_case"].includes(resolution.case_status)) return "provide_verified_status";
  }
  if (domain === "payment") {
    if (missing.has("payment_period")) return "clarify_payment_period";
    if (missing.has("payment_document") || resolution.case_status === "record_not_found") return "request_document";
    if (resolution.case_status === "pending_bank_confirmation") return "acknowledge_received_information";
  }
  if (domain === "administrative_pending") {
    if ([...missing].some((item) => /document|attachment/i.test(item))) return "request_document";
    if (resolution.evidence?.length && !missing.size) return "provide_verified_status";
    return "ask_missing_information";
  }
  return "human_handoff";
}

export function renderConversationAction(action) {
  const domain = action.case_domain;
  const options = action.property_options || [];
  const rendered = {
    ask_missing_information: domain === "maintenance"
      ? "¿En qué parte de la propiedad se presenta el problema y desde cuándo lo notas?"
      : "¿Qué dato o documento necesitas consultar para este trámite?",
    request_document: domain === "payment"
      ? "¿Podrías compartir el comprobante completo e indicar a qué periodo corresponde? Quedará pendiente de validación."
      : domain === "maintenance"
        ? "¿Podrías compartir una foto donde se aprecie el área afectada? Esto ayudará a la revisión del caso."
        : "¿Podrías compartir el documento necesario para continuar con la revisión?",
    clarify_property: options.length > 1
      ? `¿A cuál propiedad te refieres: ${options.join(" o ")}?`
      : "¿A cuál de tus propiedades corresponde este asunto?",
    clarify_payment_amount: "El monto informado no coincide con el registro disponible. ¿Podrías confirmar el monto y si realizaste más de una transferencia?",
    clarify_payment_period: "¿A qué periodo corresponde el pago o comprobante que compartiste?",
    acknowledge_received_information: "La información quedó identificada y permanece pendiente de validación bancaria.",
    provide_verified_status: "El estatus disponible en InmoAdmin fue verificado. Si necesitas continuar, indícame qué parte deseas aclarar.",
    human_handoff: "Este asunto requiere revisión de una persona del equipo de Administración antes de continuar.",
    no_message: "",
  }[action.conversation_action];
  return clean(rendered, SHADOW_CONVERSATION_MESSAGE_MAX);
}

export function semanticConversationGuard(message) {
  const text = clean(message, SHADOW_CONVERSATION_MESSAGE_MAX);
  if (!text) return { allowed: true, reason: null };
  if (EXCESSIVE_PII.test(text)) return { allowed: false, reason: "excessive_pii" };
  if (FORBIDDEN_SEMANTICS.some((pattern) => pattern.test(text))) return { allowed: false, reason: "forbidden_operational_commitment" };
  if (/\b(?:ia|inteligencia artificial|modelo|prompt|sistema interno)\b/i.test(text)) return { allowed: false, reason: "internal_process_reference" };
  return { allowed: true, reason: null };
}

export function buildConversationAction({ resolution, decision = {}, turn = {}, now = Date.now() } = {}) {
  if (turn.settled === false) return {
    version: SHADOW_CONVERSATION_ACTION_VERSION, case_domain: resolution?.case_domain,
    conversation_action: "no_message", question_type: "no_message", status: "rejected",
    proposed_message: "", evidence_refs: [], property_options: [], confidence: 0,
    requires_human: true, auto_send_eligible: false, blocked_reason: "turn_not_settled",
    expires_at: new Date(now + SHADOW_CONVERSATION_ACTION_TTL_MS).toISOString(), superseded_by_message_id: null,
  };
  const conversationAction = chooseAction(resolution, decision);
  const sensitive = Boolean(resolution?.requires_human || resolution?.conflict_detected || resolution?.technical_error
    || resolution?.case_domain === "payment" || Number(resolution?.action_confidence || 0) < 0.65);
  const candidate = validateConversationAction({
    version: SHADOW_CONVERSATION_ACTION_VERSION,
    case_domain: resolution?.case_domain,
    conversation_action: conversationAction,
    question_type: conversationAction,
    evidence_refs: evidenceRefs(resolution),
    property_options: propertyOptions(resolution),
    confidence: Math.max(0, Math.min(1, Number(resolution?.action_confidence || 0))),
    requires_human: sensitive || ["human_handoff", "no_message"].includes(conversationAction),
    auto_send_eligible: !sensitive && !["human_handoff", "no_message"].includes(conversationAction),
  });
  let proposedMessage = renderConversationAction(candidate);
  const semantic = semanticConversationGuard(proposedMessage);
  if (!semantic.allowed) {
    candidate.conversation_action = "human_handoff";
    candidate.question_type = "human_handoff";
    candidate.requires_human = true;
    candidate.auto_send_eligible = false;
    candidate.blocked_reason = semantic.reason;
    proposedMessage = renderConversationAction(candidate);
  }
  const superseded = Boolean(turn.humanResponseId);
  return {
    ...candidate,
    status: superseded ? "superseded" : "proposed",
    proposed_message: proposedMessage,
    blocked_reason: candidate.blocked_reason || (candidate.auto_send_eligible ? null : (resolution?.human_reason || resolution?.case_status || "human_review")),
    expires_at: new Date(now + SHADOW_CONVERSATION_ACTION_TTL_MS).toISOString(),
    superseded_by_message_id: superseded ? turn.humanResponseId : null,
  };
}

export async function persistConversationAction(admin, { run, message, resolution, decision, telemetry, env = process.env, now = Date.now() } = {}) {
  if (conversationActionCapabilities(env).enabled !== true) return { status: "disabled" };
  assertConversationActionShadowMode(env);
  const turnKey = clean(telemetry?.turn_key, 160);
  if (!turnKey || !run?.id || !message?.id || !message?.conversation_id) return { status: "invalid_turn_identity" };
  const action = buildConversationAction({ resolution, decision, turn: { humanResponseId: telemetry?.human_response_id || null }, now });
  const row = {
    ai_run_id: run.id, message_id: message.id, conversation_id: message.conversation_id, turn_key: turnKey,
    case_domain: action.case_domain, conversation_action: action.conversation_action, question_type: action.question_type,
    status: action.status, proposed_message: action.proposed_message || null, evidence_refs: action.evidence_refs,
    confidence: action.confidence, requires_human: action.requires_human, auto_send_eligible: action.auto_send_eligible,
    blocked_reason: action.blocked_reason || null, expires_at: action.expires_at,
    superseded_by_message_id: action.superseded_by_message_id || null,
    superseded_at: action.status === "superseded" ? new Date(now).toISOString() : null,
  };
  const { data, error } = await admin.from("shadow_conversation_actions").insert(row).select("id,status").single();
  if (error?.code === "23505") return { status: "duplicate" };
  if (error) throw error;
  return { status: data.status, actionId: data.id, action };
}

export async function supersedeConversationActionsForHumanResponses(admin, messages = [], env = process.env) {
  if (conversationActionCapabilities(env).enabled !== true) return { superseded: 0 };
  assertConversationActionShadowMode(env);
  const { data: proposed, error } = await admin.from("shadow_conversation_actions")
    .select("id,message_id,conversation_id,created_at,expires_at").eq("status", "proposed").limit(200);
  if (error) throw error;
  const byId = new Map(messages.map((item) => [item.id, item]));
  let superseded = 0;
  for (const action of proposed || []) {
    if (Date.parse(action.expires_at) <= Date.now()) {
      const { error: expireError } = await admin.from("shadow_conversation_actions").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", action.id).eq("status", "proposed");
      if (expireError) throw expireError;
      continue;
    }
    const anchor = byId.get(action.message_id);
    const human = messages.find((item) => item.conversation_id === action.conversation_id && item.direction === "outbound_human"
      && Date.parse(item.occurred_at) > Date.parse(anchor?.occurred_at || action.created_at));
    if (!human) continue;
    const { error: updateError } = await admin.from("shadow_conversation_actions").update({ status: "superseded", superseded_by_message_id: human.id, superseded_at: new Date().toISOString() }).eq("id", action.id).eq("status", "proposed");
    if (updateError) throw updateError;
    superseded += 1;
  }
  return { superseded };
}

export function conversationActionMetrics(actions = [], eligibleTurns = 0) {
  const counts = Object.fromEntries(SHADOW_CONVERSATION_ACTIONS.map((key) => [key, 0]));
  let autoSendCandidates = 0, superseded = 0, expired = 0;
  for (const action of actions) {
    if (Object.hasOwn(counts, action.conversation_action)) counts[action.conversation_action] += 1;
    if (action.auto_send_eligible) autoSendCandidates += 1;
    if (action.status === "superseded") superseded += 1;
    if (action.status === "expired") expired += 1;
  }
  return { total: actions.length, ...counts, superseded, expired, auto_send_candidates: autoSendCandidates, conversational_automation_candidate_rate: eligibleTurns ? autoSendCandidates / eligibleTurns : 0 };
}
