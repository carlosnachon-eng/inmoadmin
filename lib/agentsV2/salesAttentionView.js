const REASONS = new Set([
  "missing_text","commercial_service_offer","inventory_absence_not_proven","cta_requires_clarification",
  "internal_meta_output","risky_topic","appointment_requires_validation","appointment_commitment_requires_validation",
  "owner_continuity_no_sales_outbound","social_appointment_output_requires_review","stale_run","handoff_exists","open_human_review",
  "not_allowlisted","newer_inbound_exists","unresolved_reference_requires_review","repeated_clarification_requires_review",
  "sender_requires_review","workflow_not_configured","existing_responsible_preserved","assignment_live_state_unverified",
  "assignment_state_requires_review","owner_continuity_no_sales_handoff","automation_fallback_requires_review","handoff_intent_unverified",
  "social_assignment_state_changed_requires_review","social_effect_uncertain_manual_review","social_effect_receipt_uncertain_manual_review",
  "respond_delivery_unknown","respond_rejected",
  "protected_assignment_social_off","protected_assignment_route_unverified","protected_assignment_current_route_not_sales","protected_assignment_handoff_not_pending",
  "protected_assignment_cutover_unconfigured","protected_assignment_before_cutover","protected_assignment_other_handoff_requires_review",
  "protected_assignment_verification_failed","social_effect_reservation_failed",
]);
export const safeSalesAttentionReason=value=>value==null?null:REASONS.has(value)?value:"requires_manual_review";
export function salesAttentionDelivery(row){
  if(!row)return null;
  return {status:["processing","sent","blocked","failed","superseded"].includes(row.status)?row.status:"unknown",
    error_code:safeSalesAttentionReason(row.error_code),sent_at:row.sent_at||null};
}
