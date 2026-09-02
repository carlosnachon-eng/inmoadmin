select *
from public.claim_shadow_admin_outbound_canary(
  'canary-dev-worker',
  (select id from public.shadow_admin_outbound_canaries order by created_at desc limit 1),
  (select not_before from public.shadow_admin_outbound_canaries order by created_at desc limit 1)
);
