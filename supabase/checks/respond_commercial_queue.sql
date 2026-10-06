-- Read-only. No message content, contacts, payloads or secret configuration.
select relrowsecurity as rls,
  has_table_privilege('service_role','public.respond_commercial_jobs','SELECT') as service_select,
  not has_table_privilege('service_role','public.respond_commercial_jobs','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as service_no_direct_write,
  not has_table_privilege('anon','public.respond_commercial_jobs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon_denied,
  not has_table_privilege('authenticated','public.respond_commercial_jobs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as authenticated_denied
from pg_class where oid='public.respond_commercial_jobs'::regclass;

select p.proname,p.prosecdef as security_definer,p.proconfig,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
  not has_function_privilege('anon',p.oid,'EXECUTE') as anon_denied,
  not has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_denied,
  not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_denied
from pg_proc p where p.pronamespace='public'::regnamespace
  and p.proname in ('enqueue_respond_commercial_v1','claim_respond_commercial_v1','finish_respond_commercial_v1') order by p.proname;

select state,reason,count(*) as jobs,min(created_at) as oldest,max(attempts) as max_attempts,
  count(*) filter(where state='processing' and lease_until<now()) as expired_leases
from public.respond_commercial_jobs group by state,reason order by state,reason;
