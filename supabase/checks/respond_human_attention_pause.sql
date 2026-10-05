-- Catalog-only postcheck; no real contacts, no mutation, no resume/dispatch RPC.
select relrowsecurity as rls,
  not has_table_privilege('anon','public.respond_ai_resumptions','SELECT,INSERT,UPDATE,DELETE') as anon_denied,
  not has_table_privilege('authenticated','public.respond_ai_resumptions','SELECT,INSERT,UPDATE,DELETE') as direct_user_denied,
  has_table_privilege('service_role','public.respond_ai_resumptions','SELECT,INSERT') as service_access,
  not has_table_privilege('service_role','public.respond_ai_resumptions','UPDATE,DELETE') as audit_immutable_for_service
from pg_class where oid='public.respond_ai_resumptions'::regclass;
select proname,
  not has_function_privilege('anon',p.oid,'EXECUTE') as anon_denied,
  has_function_privilege('authenticated',p.oid,'EXECUTE') = (proname='resume_respond_ai_v1') as explicit_user_boundary,
  prosecdef = (proname='resume_respond_ai_v1') as definer_only_for_authenticated_resume,
  proconfig @> array['search_path=""'] as empty_search_path
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in ('read_respond_human_pause_v1','pause_sales_on_respond_human_v1','begin_sales_human_guarded_send_v1','resume_respond_ai_v1');
select tgenabled='O' as enabled from pg_trigger
where tgrelid='public.gv_respond_webhook_events'::regclass and tgname='respond_human_attention_received';
select indisvalid as valid from pg_index where indexrelid='public.respond_human_attention_events_idx'::regclass;
