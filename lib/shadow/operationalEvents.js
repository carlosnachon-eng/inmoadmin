import crypto from "node:crypto";

export const OPERATIONAL_EVENT_TYPES = new Set([
  "maintenance_ticket_created",
  "maintenance_quote_approved",
]);
export const MAINTENANCE_SCOPES = new Set(["managed_property", "external_job"]);
const SAFE_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9 ._:/#-]{0,119}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);
export const operationalEventFingerprint = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

export function validateMaintenanceScope({ maintenanceScope, propertyId, workReference }) {
  const scope = clean(maintenanceScope, 40);
  const property = clean(propertyId, 80) || null;
  const reference = clean(workReference, 120) || null;
  if (!MAINTENANCE_SCOPES.has(scope)) throw new Error("maintenance_scope inválido.");
  if (scope === "managed_property" && !property) throw new Error("managed_property requiere propertyId.");
  if (scope === "external_job" && property) throw new Error("external_job no admite propertyId.");
  if (scope === "external_job" && (!reference || !SAFE_REFERENCE.test(reference) || /https?:\/\/|@|\+?\d[\d\s.-]{8,}/i.test(reference))) throw new Error("external_job requiere workReference segura.");
  return { maintenanceScope: scope, propertyId: property, workReference: reference };
}

export function validateOperationalPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Payload operativo inválido.");
  const eventType = clean(input.eventType, 80);
  if (!OPERATIONAL_EVENT_TYPES.has(eventType)) throw new Error("eventType operativo no permitido.");
  const scope = validateMaintenanceScope(input);
  const ticketId = clean(input.ticketId, 80);
  if (!ticketId) throw new Error("ticketId requerido.");
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new Error("occurredAt inválido.");
  const payload = {
    eventType,
    ticketId,
    maintenanceScope: scope.maintenanceScope,
    propertyId: scope.propertyId,
    workReference: scope.workReference,
    priority: clean(input.priority, 30) || null,
    payer: clean(input.payer, 30) || null,
    status: clean(input.status, 30) || null,
    occurredAt: occurredAt.toISOString(),
  };
  if (eventType === "maintenance_quote_approved") {
    payload.quoteId = clean(input.quoteId, 80);
    if (!payload.quoteId) throw new Error("quoteId requerido.");
    payload.quoteStatus = clean(input.quoteStatus, 30);
    payload.ticketStatus = clean(input.ticketStatus, 30);
    payload.amount = Number(input.amount);
    payload.providerCost = Number(input.providerCost);
    if (payload.quoteStatus !== "aprobada" || payload.ticketStatus !== "aprobado") throw new Error("Estados de aprobación inválidos.");
    if (![payload.amount, payload.providerCost].every(Number.isFinite)) throw new Error("Importes inválidos.");
  }
  return payload;
}

export function operationalContextForPolicy(event) {
  const payload = validateOperationalPayload(event.payload_safe || event.payloadSafe || event);
  return {
    kind: "operational_event",
    source: "inmoadmin",
    eventType: payload.eventType,
    ticketId: payload.ticketId,
    quoteId: payload.quoteId || null,
    propertyId: payload.propertyId,
    maintenanceScope: payload.maintenanceScope,
    status: payload.ticketStatus || payload.status,
    amount: payload.amount ?? null,
    priority: payload.priority,
    payer: payload.payer,
    skipPropertyResolution: payload.maintenanceScope === "external_job",
  };
}

export async function processOperationalOutbox(admin,{limit=10}={}){
  const {data:pending,error}=await admin.from("inmoadmin_operational_events").select("event_id").is("processed_at",null).lte("next_attempt_at",new Date().toISOString()).order("created_at").limit(Math.min(10,Math.max(1,Number(limit)||1)));
  if(error)throw error;
  const results=[];
  for(const item of pending||[]){
    const {data,error:processError}=await admin.rpc("process_operational_event",{p_event_id:item.event_id});
    results.push({eventId:item.event_id,status:processError?"pending_after_error":(data?.status||"processed")});
  }
  return results;
}

export async function processOperationalOutboxEvent(admin,eventId){
  const normalized=clean(eventId,36);
  if(!UUID.test(normalized))throw new Error("eventId inválido.");
  const {data,error}=await admin.rpc("process_operational_event",{p_event_id:normalized});
  if(error)throw error;
  return [{eventId:normalized,status:data?.status||"processed"}];
}
