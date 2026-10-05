-- Catalog-only postcheck; no real contacts, no mutation, no resume/dispatch RPC.
select relrowsecurity as rls,
  not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon_denied,
  not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as direct_user_denied,
  has_table_privilege('service_role',c.oid,'SELECT') as service_read,
  not has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as audit_immutable_for_service,
  -- ACL allowlist also rejects MAINTAIN (PG17+), PUBLIC, grant options and any
  -- additional non-owner grantee, without depending on a PG-version keyword.
  not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where a.grantee<>c.relowner and not (a.grantee='service_role'::regrole and a.privilege_type='SELECT' and not a.is_grantable)) as exact_table_acl,
  not exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) x
    where a.attrelid=c.oid and x.grantee<>c.relowner) as no_column_grants
from pg_class c where oid='public.respond_ai_resumptions'::regclass;
select proname,
  not has_function_privilege('anon',p.oid,'EXECUTE') as anon_denied,
  has_function_privilege('authenticated',p.oid,'EXECUTE') = (proname='resume_respond_ai_v1') as explicit_user_boundary,
  has_function_privilege('service_role',p.oid,'EXECUTE') = (proname<>'resume_respond_ai_v1') as service_internal_only,
  not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0) as no_public_execute,
  not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where a.grantee<>p.proowner and not (a.grantee=case when p.proname='resume_respond_ai_v1' then 'authenticated'::regrole else 'service_role'::regrole end
      and a.privilege_type='EXECUTE' and not a.is_grantable)) as exact_function_acl,
  prosecdef = (proname='resume_respond_ai_v1') as definer_only_for_authenticated_resume,
  proconfig @> array['search_path=""'] as empty_search_path
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in ('read_respond_human_pause_v1','pause_sales_on_respond_human_v1','begin_sales_human_guarded_send_v1','resume_respond_ai_v1') order by proname;
select tgenabled='O' as enabled from pg_trigger
where tgrelid='public.gv_respond_webhook_events'::regclass and tgname='respond_human_attention_received';
select indisvalid as valid from pg_index where indexrelid='public.respond_human_attention_events_idx'::regclass;
