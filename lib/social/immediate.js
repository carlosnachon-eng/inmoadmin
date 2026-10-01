const TABLES = { SALES: "sales_agent_v2_inbound_messages", OWNER: "owner_agent_v1_inbound_messages", LEGAL: "legal_agent_v1_inbound_messages" };
export async function processSocialRouteImmediate(admin, route, processors, { env = process.env, sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)) } = {}) {
  if (!route.created) return { status: "duplicate" };
  if (!route.inboundId) return { status: "requires_human_review" };
  if (route.destination === "SALES" && (env.SALES_AGENT_V2_IMMEDIATE_ENABLED === "false" || env.SALES_AGENT_V2_AUTO_SHADOW_ENABLED !== "true")) return { status: "queued" };
  try {
    const table = TABLES[route.destination];
    if (!table || !processors[route.destination]) throw new Error("social_processor_missing");
    const { data: inbound, error } = await admin.from(table).select("id,respond_contact_id,created_at,debounce_until").eq("id", route.inboundId).single();
    if (error) throw error;
    await sleep(Math.max(0, Math.min(5000, new Date(inbound.debounce_until).getTime() - Date.now())));
    const newer = await admin.from(table).select("id").eq("respond_contact_id", inbound.respond_contact_id)
      .gt("created_at", inbound.created_at).in("status", ["captured", "processing", "processed"]).limit(1);
    if (newer.error) throw newer.error;
    if (newer.data?.length) {
      const changed = await admin.from(table).update({ status: "skipped" }).eq("id", inbound.id).eq("status", "captured");
      if (changed.error) throw changed.error;
      return { status: "absorbed_by_newer_message" };
    }
    return await processors[route.destination](admin, inbound.id, { env });
  } catch {
    // Existing lane's cron/atomic claim owns recovery. No second agent or second direct call.
    return { status: "fallback_to_existing_lane" };
  }
}
