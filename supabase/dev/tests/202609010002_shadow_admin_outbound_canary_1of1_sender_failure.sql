update public.shadow_admin_outbound_messages
set status='delivery_unknown',error_code='synthetic_dev_delivery_unknown',completed_at=now(),updated_at=now()
where canary_id=(select id from public.shadow_admin_outbound_canaries order by created_at desc limit 1)
  and status='processing';

update public.shadow_conversation_actions
set status='rejected',auto_send_eligible=false,blocked_reason='respond_delivery_unknown',updated_at=now()
where id=(select claimed_action_id from public.shadow_admin_outbound_canaries order by created_at desc limit 1)
  and status='approved_for_future_auto';

select jsonb_pretty(jsonb_build_object(
  'canary',(
    select jsonb_build_object(
      'status',status,'max_claims',max_claims,'claimed_count',claimed_count,'allowed_action',allowed_action,
      'has_conversation',claimed_conversation_id is not null,'has_action',claimed_action_id is not null,
      'has_outbound',claimed_outbound_id is not null,'close_reason',close_reason,
      'sender_result_status',sender_result_status,'has_provider_message_id',provider_message_id is not null
    ) from public.shadow_admin_outbound_canaries order by created_at desc limit 1
  ),
  'outbound_claim_count',(
    select count(*) from public.shadow_admin_outbound_messages
    where canary_id=(select id from public.shadow_admin_outbound_canaries order by created_at desc limit 1)
  ),
  'second_claim_count',(
    select count(*) from public.claim_shadow_admin_outbound_canary(
      'canary-dev-worker-after-failure',
      (select id from public.shadow_admin_outbound_canaries order by created_at desc limit 1),
      (select not_before from public.shadow_admin_outbound_canaries order by created_at desc limit 1)
    )
  )
)) as canary_failure_evidence;
