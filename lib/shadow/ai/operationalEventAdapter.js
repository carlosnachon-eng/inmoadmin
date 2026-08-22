import { operationalContextForPolicy, validateOperationalPayload } from "../operationalEvents.js";

const SUPPORTED = new Set(["maintenance_ticket_created", "maintenance_quote_approved"]);

export function operationalEventToP3Input(event) {
  if (!event || event.kind !== "operational_event" || event.source !== "inmoadmin" || !SUPPORTED.has(event.event_type)) throw new Error("unsupported_shadow_operational_event");
  const payload = validateOperationalPayload(event.payload_safe || {});
  const operationalContext = operationalContextForPolicy(event);
  return {
    inputKind: "operational_event", inputId: String(event.id), occurredAt: payload.occurredAt,
    eventType: payload.eventType, operationalContext,
    envelope: {
      provider: "inmoadmin_operational", direction: "internal", occurredAt: payload.occurredAt, externalMessageId: null,
      sanitizedText: payload.eventType === "maintenance_quote_approved"
        ? "Evento estructurado: cotización de mantenimiento aprobada."
        : "Evento estructurado: ticket de mantenimiento creado.",
      providerMetadata: {
        operationalEvent: true, eventType: payload.eventType, ticketId: payload.ticketId,
        quoteId: payload.quoteId || null, maintenanceScope: payload.maintenanceScope,
        propertyId: payload.propertyId, status: payload.ticketStatus || payload.status || null,
        priority: payload.priority || null, payer: payload.payer || null,
        amount: payload.amount ?? null, providerCost: payload.providerCost ?? null, occurredAt: payload.occurredAt,
      },
    },
  };
}

export function finalizeOperationalP3Decision(decision, input) {
  return {
    ...decision,
    proposedResponse: null,
    operationalOutput: {
      interpretation: decision.summary,
      operationalContext: input.operationalContext,
      recommendedFollowUp: decision.proposedAction,
      requiresHuman: Boolean(decision.requiresHuman),
      risk: decision.urgency,
      priority: input.operationalContext.priority || decision.urgency,
      evidenceIds: (decision.factualClaims || []).flatMap((claim) => claim.evidenceIds || []),
    },
  };
}
