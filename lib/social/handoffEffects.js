// The marker is persisted on a handoff by DB trigger, so OFF does not release prior reservations.
export async function onceSocialHandoffEffect(admin, { kind, handoff, phase, effect }) {
  if (!handoff.social_route_id) return effect(); // untouched legacy lane
  const reservation = await admin.rpc("reserve_social_effect_v1", { p_kind: kind, p_handoff_id: handoff.id, p_phase: phase });
  if (reservation.error) throw new Error("social_effect_reservation_failed");
  const receipt = reservation.data;
  if (!receipt?.owned) {
    if (receipt?.status === "completed") return receipt.resultRef;
    throw new Error("social_effect_uncertain_manual_review");
  }
  let result;
  try { result = await effect(); }
  catch {
    // An HTTP error can be ambiguous too. Never release/retry the transport reservation.
    await admin.rpc("finish_social_effect_v1", { p_token: receipt.token, p_status: "uncertain", p_result_ref: null });
    throw new Error("social_effect_uncertain_manual_review");
  }
  const finished = await admin.rpc("finish_social_effect_v1", { p_token: receipt.token, p_status: "completed", p_result_ref: typeof result === "string" ? result : null });
  if (finished.error) throw new Error("social_effect_receipt_uncertain_manual_review");
  return result;
}
