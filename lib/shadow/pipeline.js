import { classifyShadowMessage, ingestShadowEnvelope, syntheticEnvelope } from "./coordinator.js";
import { resolveShadowContext } from "./context.js";

export async function processSyntheticShadowFixture(admin, [id, text, metadata]) {
  const envelope = syntheticEnvelope({ id, text, metadata });
  const classification = classifyShadowMessage(envelope);
  const result = await ingestShadowEnvelope(admin, envelope);
  if (result?.status !== "accepted") return { ...result, fixtureId: id, classification, context: null };
  const context = await resolveShadowContext(admin, envelope, classification);
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
  return { ...result, fixtureId: id, classification, context };
}
