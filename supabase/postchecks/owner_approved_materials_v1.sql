-- Read-only catalog checks; does not activate, register, dispatch or return contact data.
select c.relname,c.relrowsecurity,
  has_table_privilege('anon',c.oid,'SELECT') as anon_select,
  has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select,
  has_table_privilege('service_role',c.oid,'SELECT') as service_select,
  has_table_privilege('service_role',c.oid,'INSERT') as service_insert,
  has_table_privilege('service_role',c.oid,'DELETE') as service_delete
from pg_class c where c.oid in ('public.owner_approved_material_versions'::regclass,'public.owner_material_deliveries'::regclass);
select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('owner_approved_material_versions','owner_material_deliveries');
select p.proname,p.prosecdef,p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('activate_owner_material_version','reserve_owner_material_delivery','claim_owner_material_delivery');
select tgname,tgenabled from pg_trigger where tgrelid in ('public.owner_approved_material_versions'::regclass,'public.owner_material_deliveries'::regclass) and not tgisinternal;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='owner-approved-materials';
select policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='storage' and policyname='owner_material_objects_private';
