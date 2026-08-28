export const ADMIN_WORK_R0_TOOLS = Object.freeze([
  "list_administrative_work", "get_administrative_work", "find_administrative_work_by_context",
  "find_possible_duplicate_work", "get_administrative_work_history", "get_administrative_evidence_summary", "get_pending_approvals",
]);

export const ADMIN_WORK_R1_ACTIONS = Object.freeze([
  "create_administrative_pending", "append_structured_internal_note", "link_received_evidence",
  "mark_information_received", "set_nonfinancial_next_step", "schedule_nonfinancial_follow_up", "mark_possible_duplicate",
  "assign_operational_responsible",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_REF = /^[a-zA-Z0-9:_./-]{1,160}$/;
const FORBIDDEN = /\b(?:payment[_ ]?confirmed|pago confirmado|saldo liquidado|devoluci[oó]n autorizada|autorizar gasto|consejo jur[ií]dico|cerrar (?:ticket|caso)|cancelar contrato)\b/i;
const MAX_RESULTS = 20;

export function administrativeWorkR1Enabled(env = process.env) {
  return String(env.SHADOW_ADMIN_WORK_R1_ENABLED || "").toLowerCase() === "true";
}

const safeText = (value, max = 500) => {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text || text.length > max || FORBIDDEN.test(text)) throw new Error("invalid_r1_payload");
  return text;
};

const safeId = (value, required = false) => {
  if (value === null || value === undefined || value === "") {
    if (required) throw new Error("invalid_r1_payload");
    return null;
  }
  if (!UUID.test(String(value))) throw new Error("invalid_r1_payload");
  return String(value);
};

const safeRef = (value, required = false) => {
  if (value === null || value === undefined || value === "") {
    if (required) throw new Error("invalid_r1_payload");
    return null;
  }
  const text = String(value).trim();
  if (!SAFE_REF.test(text)) throw new Error("invalid_r1_payload");
  return text;
};

export function validateAdministrativeWorkR1(action, input = {}) {
  if (!ADMIN_WORK_R1_ACTIONS.includes(action) || !input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_r1_action");
  const common = {
    workItemId: safeId(input.workItemId),
    note: input.note == null ? null : safeText(input.note, 1000),
    sourceType: safeRef(input.sourceType), sourceId: safeRef(input.sourceId),
    sourceLinkType: safeRef(input.sourceLinkType), sourceLinkKey: safeRef(input.sourceLinkKey),
  };
  if (action === "create_administrative_pending") return {
    ...common, domain: safeRef(input.domain, true), workType: safeRef(input.workType, true),
    title: safeText(input.title, 180), dedupeKey: safeRef(input.dedupeKey, true),
    priority: input.priority == null ? "P2" : safeRef(input.priority, true),
    sourceType: safeRef(input.sourceType, true), sourceId: safeRef(input.sourceId, true),
    sourceContextKey: safeRef(input.sourceContextKey), nextStep: input.nextStep == null ? null : safeText(input.nextStep, 500),
    requiresAuthorization: input.requiresAuthorization === true,
    clientIdentityId: safeId(input.clientIdentityId), contractId: safeId(input.contractId),
    propertyId: safeId(input.propertyId), condominiumId: safeId(input.condominiumId), unitId: safeId(input.unitId),
    responsibleArea: input.responsibleArea == null ? null : safeText(input.responsibleArea, 80),
  };
  if (!common.workItemId) throw new Error("invalid_r1_payload");
  if (action === "set_nonfinancial_next_step") return { ...common, nextStep: safeText(input.nextStep, 500) };
  if (action === "schedule_nonfinancial_follow_up") {
    const date = new Date(input.followupAt);
    if (!input.followupAt || Number.isNaN(date.getTime())) throw new Error("invalid_r1_payload");
    return { ...common, followUpAt: date.toISOString() };
  }
  if (action === "mark_possible_duplicate") return { ...common, duplicateOfId: safeId(input.duplicateOfId, true) };
  if (action === "assign_operational_responsible") return { ...common, responsibleProfileId: safeId(input.responsibleProfileId, true) };
  if (action === "link_received_evidence") return { ...common, evidenceType: safeRef(input.evidenceType, true), referenceType: safeRef(input.referenceType, true), referenceId: safeRef(input.referenceId, true), evidenceKey: safeRef(input.evidenceKey, true), summarySafe: safeText(input.summarySafe, 500) };
  return common;
}

export async function executeAdministrativeWorkR1(admin, { action, input, idempotencyKey, actorType = "admin", actorProfileId }, env = process.env) {
  if (!administrativeWorkR1Enabled(env)) { const error = new Error("admin_work_r1_disabled"); error.statusCode = 409; throw error; }
  const valid = validateAdministrativeWorkR1(action, input);
  const key = safeRef(idempotencyKey, true);
  if (key.length < 12) throw new Error("invalid_r1_payload");
  const aiActor = actorType === "ai";
  const actor = aiActor ? null : safeId(actorProfileId, true);
  const { data, error } = await admin.rpc("execute_administrative_work_r1", { p_action: action, p_input: valid, p_idempotency_key: key, p_actor_type: aiActor ? "ai" : "human", p_actor_profile_id: aiActor ? null : actor });
  if (error) throw error;
  return data;
}

const sanitizeItem = (row) => ({
  id: row.id, domain: row.domain, workType: row.work_type, title: row.title, status: row.status,
  priority: row.priority, clientIdentityId: row.client_identity_id, contractId: row.contract_id,
  propertyId: row.property_id, condominiumId: row.condominium_id, unitId: row.unit_id,
  responsibleArea: row.responsible_area, responsibleProfileId: row.responsible_profile_id,
  nextStep: row.next_step, followupAt: row.followup_at, informationReceivedAt: row.information_received_at,
  requiresAuthorization: Boolean(row.requires_authorization), duplicateOfId: row.duplicate_of_id,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

const queryRows = async (query, mapper = (x) => x) => {
  const { data, error } = await query.limit(MAX_RESULTS);
  if (error) throw error;
  return (data || []).map(mapper);
};

export async function executeAdministrativeWorkR0(admin, name, args = {}) {
  if (!ADMIN_WORK_R0_TOOLS.includes(name)) throw new Error("tool_not_allowlisted");
  const id = args.workItemId ? safeId(args.workItemId, true) : null;
  if (name === "get_administrative_work") return queryRows(admin.from("administrative_work_items").select("*").eq("id", id), sanitizeItem);
  if (name === "list_administrative_work" || name === "find_administrative_work_by_context" || name === "find_possible_duplicate_work") {
    let query = admin.from("administrative_work_items").select("*").order("updated_at", { ascending: false });
    for (const [arg, column] of Object.entries({ clientIdentityId: "client_identity_id", contractId: "contract_id", propertyId: "property_id" })) if (args[arg]) query = query.eq(column, safeId(args[arg], true));
    for (const [arg, column] of Object.entries({ domain: "domain", status: "status", sourceType: "primary_source_type", sourceId: "primary_source_id" })) if (args[arg]) query = query.eq(column, safeRef(args[arg], true));
    if (name === "find_possible_duplicate_work") query = query.not("status", "in", "(resolved,cancelled)");
    return queryRows(query, sanitizeItem);
  }
  const table = name === "get_administrative_work_history" ? "administrative_work_history" : name === "get_administrative_evidence_summary" ? "administrative_work_evidence" : "administrative_work_approvals";
  let query = admin.from(table).select("*").order("created_at", { ascending: false });
  if (id) query = query.eq("work_item_id", id);
  if (name === "get_pending_approvals") query = query.eq("status", "pending");
  return queryRows(query, (row) => {
    if (name === "get_administrative_evidence_summary") return { id: row.id, workItemId: row.work_item_id, evidenceType: row.evidence_type, summary: row.summary_safe, receivedAt: row.received_at };
    if (name === "get_administrative_work_history") return { id: row.id, workItemId: row.work_item_id, actorType: row.actor_type, actionType: row.action_type, reason: row.reason, capability: row.capability, createdAt: row.created_at };
    return { id: row.id, workItemId: row.work_item_id, requestedCapability: row.requested_capability, riskTier: row.risk_tier, status: row.status, reason: row.reason_safe, createdAt: row.created_at, expiresAt: row.expires_at };
  });
}
