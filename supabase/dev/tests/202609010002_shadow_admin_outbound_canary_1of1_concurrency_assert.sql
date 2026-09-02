select c.id as canary_id,c.not_before,c.status,c.max_claims,c.claimed_count,c.allowed_action,
  c.claimed_conversation_id is not null as has_conversation,
  c.claimed_action_id is not null as has_action,
  c.claimed_outbound_id is not null as has_outbound,
  c.claimed_at,c.closed_at,c.close_reason,c.sender_result_status,
  c.provider_message_id is not null as has_provider_message_id,
  count(o.id) as outbound_claim_count
from public.shadow_admin_outbound_canaries c
left join public.shadow_admin_outbound_messages o on o.canary_id=c.id
where c.created_at >= now() - interval '10 minutes'
group by c.id
order by c.created_at desc
limit 1;

select count(*) as second_claim_count
from public.claim_shadow_admin_outbound_canary(
  'canary-dev-worker-repeat',
  (select id from public.shadow_admin_outbound_canaries where status='closed' order by created_at desc limit 1),
  (select not_before from public.shadow_admin_outbound_canaries where status='closed' order by created_at desc limit 1)
);
