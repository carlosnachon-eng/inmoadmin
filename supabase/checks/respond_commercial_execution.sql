-- Read-only postcheck; no flags, defaults or data changes.
select relrowsecurity as rls,
 has_table_privilege('service_role',oid,'SELECT') as service_read,
 not has_table_privilege('service_role',oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as no_direct_service_write,
 not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon_denied,
 not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as authenticated_denied
from pg_class where oid='public.respond_commercial_executions'::regclass;

select p.proname,p.prosecdef,p.proconfig,
 has_function_privilege('service_role',p.oid,'EXECUTE')=(p.proname<>'respond_execution_has_effect_v1') as exact_service_acl,
 not has_function_privilege('anon',p.oid,'EXECUTE') as anon_denied,
 not has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_denied,
 not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where a.grantee=0 and a.privilege_type='EXECUTE') as public_denied
from pg_proc p where pronamespace='public'::regnamespace and proname in
 ('respond_execution_has_effect_v1','claim_respond_execution_v1','step_respond_execution_v1','next_respond_execution_v1') order by proname;

select indexname from pg_indexes where schemaname='public' and tablename='respond_commercial_executions' order by indexname;
select column_default from information_schema.columns where table_schema='public' and table_name='respond_commercial_jobs' and column_name='execution_recovery';
select md5(pg_get_functiondef(oid)) as definition_hash,proname from pg_proc where pronamespace='public'::regnamespace and proname in
 ('guard_social_inbound_v1','read_respond_human_pause_v1','pause_sales_on_respond_human_v1','begin_sales_human_guarded_send_v1','resume_respond_ai_v1') order by proname;
