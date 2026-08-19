import { classifyShadowMessage, ingestShadowEnvelope, syntheticEnvelope } from "./coordinator.js";
import { resolveShadowContext } from "./context.js";

const CONTEXT_RELEVANT_INTENTS = new Set([
  "reportar_mantenimiento", "seguimiento_mantenimiento", "enviar_comprobante_renta",
  "enviar_comprobante_servicio", "consulta_pago", "consulta_servicio", "renovacion",
  "entrega_llaves", "solicitud_llaves", "propietario_liquidacion",
  "propietario_mantenimiento", "proveedor_seguimiento", "firma", "cita_firma",
  "poliza", "contrato", "condominio_cuota", "condominio_incidencia",
  "queja_conflicto", "emergencia", "tarea_recurrente", "comprobante_propietario",
  "datos_incompletos", "multintencion",
]);

export function shadowContextState(envelope, classification, context) {
  if (envelope.direction !== "inbound") return { contextStatus: "not_applicable", semanticContextNeeded: false };
  if (context?.matches?.length) return { contextStatus: context.ambiguous ? "ambiguous" : "resolved", semanticContextNeeded: false };
  const needed = CONTEXT_RELEVANT_INTENTS.has(classification?.intent);
  return { contextStatus: needed ? "unresolved" : "not_applicable", semanticContextNeeded: needed };
}

export async function processShadowEnvelope(admin, envelope, {
  contextResolver = resolveShadowContext,
} = {}) {
  const classification = classifyShadowMessage(envelope);
  const result = await ingestShadowEnvelope(admin, envelope);
  if (result?.status !== "accepted" || envelope.direction !== "inbound") {
    return { ...result, classification, context: null, ...shadowContextState(envelope, classification, null) };
  }
  const context = await contextResolver(admin, envelope, classification);
  if (context.matches.length) {
    const { error } = await admin.from("shadow_context_matches").upsert(context.matches.map((match) => ({
      message_id: result.messageId,
      internal_entity_type: match.entityType,
      internal_id: match.internalId,
      display_label: match.label,
      match_method: match.method,
      confidence_rank: match.confidence,
      ambiguous: context.ambiguous,
      reason_code: match.reasonCode,
      context_href: match.href,
    })), { onConflict: "message_id,internal_entity_type,internal_id" });
    if (error) throw error;
  }
  if (context.audit.length) {
    const { error } = await admin.from("shadow_context_query_audit").insert(context.audit.map((item) => ({
      message_id: result.messageId,
      tool_name: item.tool,
      result_count: Math.min(5, item.resultCount),
      succeeded: item.ok,
      duration_ms: item.durationMs,
    })));
    if (error) throw error;
  }
  return { ...result, classification, context, ...shadowContextState(envelope, classification, context) };
}

export async function processSyntheticShadowFixture(admin, [id, text, metadata]) {
  const result = await processShadowEnvelope(admin, syntheticEnvelope({ id, text, metadata }));
  return { ...result, fixtureId: id };
}
