-- Read-only catalog checks; all booleans must be true. No customer data returned.
select c.relname, c.relrowsecurity as rls_enabled,
  has_table_privilege('service_role',c.oid,'SELECT') as server_can_read,
  not has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') as server_cannot_bypass_rpc,
  not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_denied,
  not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_denied
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('social_message_routes','social_handoff_effects','social_appointment_keys')
order by c.relname;
select p.proname,p.prosecdef as security_definer,
  p.proconfig @> array['search_path=""'] as fixed_search_path,
  has_function_privilege('service_role',p.oid,'EXECUTE') as server_can_execute,
  not has_function_privilege('anon',p.oid,'EXECUTE') as anon_denied,
  not has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_denied
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('capture_social_route_v1','reserve_social_effect_v1','finish_social_effect_v1','commit_social_appointment_v1')
order by p.proname;
select count(*)=6 as all_triggers_enabled from pg_trigger
where not tgisinternal and tgenabled='O' and tgname in (
  'social_sales_inbound_guard','social_owner_inbound_guard','social_legal_inbound_guard',
  'social_sales_handoff_binding','social_legal_handoff_binding','social_appointment_binding');
select conrelid::regclass as relation,conname,pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid in ('public.social_message_routes'::regclass,'public.social_handoff_effects'::regclass,'public.social_appointment_keys'::regclass)
order by relation,conname;
