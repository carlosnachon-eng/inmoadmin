// Deliberately unconnected: no webhook, cron, routing, model or sender imports.
// The database evaluates authoritative journals atomically; callers cannot
// submit a verdict, candidate list, fake wamid mapping or business permission.
export async function assessAdminObservation({ db, metaEventId } = {}) {
  if (!db || typeof db.rpc !== "function" ||
      typeof metaEventId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(metaEventId)) {
    throw new Error("messaging_correlation_input_invalid");
  }
  let result;
  try {
    result = await db.rpc("assess_messaging_admin_correlation_v1", { p_meta_event_id: metaEventId });
  } catch {
    throw new Error("messaging_correlation_evaluation_failed");
  }
  const { data, error } = result || {};
  // Never log/propagate raw database errors or provider evidence.
  if (error || !data || !["matched", "unmatched", "ambiguous"].includes(data.state) ||
      data.observer_only !== true || data.business_dedupe_allowed !== false || data.human_authorship_proven !== false) {
    throw new Error("messaging_correlation_evaluation_failed");
  }
  return data;
}
