// Dispatch authority only. Does not change routing/continuity or grant legacy access.
const CHANNELS = new Set(["497382", "497385", "498219", "515318"]);
const instant = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)
  ? Date.parse(value) : NaN;
const timestamp = value => value ? Date.parse(value) : NaN;

export async function protectedSalesAssignmentContext(db, handoff, env, { reservedPhase = null } = {}) {
  if (env.SOCIAL_ROUTING_V1_ENABLED !== "true") return { reason: "protected_assignment_social_off" };
  const pending = await db.from("sales_agent_v2_handoffs").select("status").eq("id", handoff.id).maybeSingle();
  if (pending.error) throw pending.error;
  if (!["ready_for_advisor", "assignment_requested"].includes(pending.data?.status))
    return { reason: "protected_assignment_handoff_not_pending" };
  if (!handoff.social_route_id || !CHANNELS.has(String(handoff.channel_id)))
    return { reason: "protected_assignment_route_unverified" };

  const fields = "id,inbound_id,respond_contact_id,source_channel_id,destination,occurred_at,created_at";
  const origin = await db.from("social_message_routes").select(fields).eq("id", handoff.social_route_id)
    .eq("respond_contact_id", handoff.respond_contact_id).eq("source_channel_id", String(handoff.channel_id)).maybeSingle();
  if (origin.error) throw origin.error;
  if (!origin.data || origin.data.destination !== "SALES" || origin.data.inbound_id !== handoff.inbound_message_id)
    return { reason: "protected_assignment_route_unverified" };

  // Assignment authority includes HUMAN_REVIEW. The continuity RPC deliberately
  // excludes it: that selector must NOT be reused as permission to assign.
  // Same deterministic order as capture (#165), but no destination exclusion.
  const latest = await db.from("social_message_routes").select(fields)
    .eq("respond_contact_id", handoff.respond_contact_id).eq("source_channel_id", String(handoff.channel_id))
    .order("occurred_at", { ascending: false }).order("created_at", { ascending: false })
    .order("id", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw latest.error;
  if (!latest.data) return { reason: "protected_assignment_route_unverified" };
  if (latest.data.destination !== "SALES") return { reason: "protected_assignment_current_route_not_sales" };
  const changedLane = await db.from("social_message_routes").select("id")
    .eq("respond_contact_id", handoff.respond_contact_id).eq("source_channel_id", String(handoff.channel_id))
    .neq("destination", "SALES").gte("occurred_at", origin.data.occurred_at).limit(1);
  if (changedLane.error) throw changedLane.error;
  if (changedLane.data?.length) return { reason: "protected_assignment_current_route_not_sales" };
  const unresolved = await db.from("social_capture_receipts").select("source_event_id")
    .eq("respond_contact_id", handoff.respond_contact_id).eq("source_channel_id", String(handoff.channel_id))
    .in("routing_state", ["pending", "review_required"]).limit(1);
  if (unresolved.error) throw unresolved.error;
  if (unresolved.data?.length) return { reason: "protected_assignment_route_unverified" };

  const inbounds = await db.from("sales_agent_v2_inbound_messages")
    .select("id,sanitized_text,respond_contact_id,channel_id,social_route_id,occurred_at,created_at")
    .in("id", [...new Set([handoff.inbound_message_id, latest.data.inbound_id])])
    .eq("respond_contact_id", handoff.respond_contact_id).eq("channel_id", String(handoff.channel_id));
  if (inbounds.error) throw inbounds.error;
  const original = inbounds.data?.find(row => row.id === handoff.inbound_message_id && row.social_route_id === handoff.social_route_id);
  const current = inbounds.data?.find(row => row.id === latest.data.inbound_id && row.social_route_id === latest.data.id);
  if (!original || !current) return { reason: "protected_assignment_route_unverified" };

  const cutoff = instant(env.SALES_AGENT_V2_PROTECTED_ASSIGNMENT_NOT_BEFORE);
  if (!Number.isFinite(cutoff) || cutoff > Date.now()) return { reason: "protected_assignment_cutover_unconfigured" };
  // Both occurrence and persistence must be new. A newly created handoff for an
  // old inbound (or an old delayed delivery) cannot cross the activation cut.
  const times = [handoff.created_at, original.created_at, original.occurred_at,
    origin.data.created_at, origin.data.occurred_at, current.created_at, current.occurred_at];
  if (times.some(value => !Number.isFinite(timestamp(value)) || timestamp(value) <= cutoff || timestamp(value) > Date.now()))
    return { reason: "protected_assignment_before_cutover" };

  // Do not reuse old intent across a new lane/episode, or while another handoff
  // may own an effect. Existing reservations remain immutable; no reset/drain.
  const other = await db.from("sales_agent_v2_handoffs").select("id")
    .eq("respond_contact_id", handoff.respond_contact_id).neq("id", handoff.id)
    .in("status", ["ready_for_advisor", "assignment_requested", "assigned", "escalated"]).limit(1);
  if (other.error) throw other.error;
  if (other.data?.length) return { reason: "protected_assignment_other_handoff_requires_review" };
  const siblings = await db.from("sales_agent_v2_handoffs").select("id")
    .eq("respond_contact_id", handoff.respond_contact_id).limit(101);
  if (siblings.error) throw siblings.error;
  if (siblings.data?.length > 100) return { reason: "protected_assignment_other_handoff_requires_review" };
  const effects = await db.from("social_handoff_effects").select("handoff_id,phase,status")
    .eq("kind", "sales").in("handoff_id", [...new Set([handoff.id, ...(siblings.data || []).map(row => row.id)])])
    .in("status", ["reserved", "uncertain"]);
  if (effects.error) throw effects.error;
  if (effects.data?.some(row => !(row.handoff_id === handoff.id && row.phase === reservedPhase && row.status === "reserved")))
    return { reason: "social_effect_uncertain_manual_review" };
  return { inbound: current, routeId: latest.data.id };
}
