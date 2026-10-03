-- Read-only. All booleans must be true; expected rows: 1 table, 4 RPCs, 1 trigger, 1 index set.
select c.relrowsecurity as rls_enabled,
 has_table_privilege('service_role',c.oid,'SELECT') as server_read,
 not has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') as server_cannot_mutate_directly,
 not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_denied,
 not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_denied
from pg_class c where c.oid='public.social_capture_receipts'::regclass;
select p.proname,p.prosecdef as security_definer,p.proconfig @> array['search_path=""'] as fixed_search_path,
 has_function_privilege('service_role',p.oid,'EXECUTE') as server_execute,
 not has_function_privilege('anon',p.oid,'EXECUTE') as anon_denied,
 not has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_denied
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('read_social_route_context_v1','begin_social_capture_v1','fail_social_capture_v1','capture_social_route_v1') order by p.proname;
select count(*)=1 as receipt_trigger_enabled from pg_trigger where tgname='social_capture_receipt_after_transport' and tgenabled='O'
 and tgrelid='public.gv_respond_webhook_events'::regclass and not tgisinternal;
select count(*)=2 as indexes_present from pg_indexes where schemaname='public' and indexname in ('social_capture_review_idx','social_route_head_idx');
