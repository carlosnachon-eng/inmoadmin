-- DEV-only read-only checks.
do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if to_regclass('public.shadow_ai_manual_authorizations') is null then raise exception 'authorization table missing'; end if;
  if obj_description('public.shadow_ai_manual_authorizations'::regclass) not like 'dev-bootstrap:202608220001:%' then raise exception 'DEV marker missing'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='shadow_ai_manual_authorizations' and c.relrowsecurity) then raise exception 'RLS disabled'; end if;
  if has_table_privilege('anon','public.shadow_ai_manual_authorizations','SELECT,INSERT,UPDATE,DELETE') then raise exception 'anon access forbidden'; end if;
  if has_table_privilege('authenticated','public.shadow_ai_manual_authorizations','INSERT,UPDATE,DELETE') then raise exception 'authenticated write forbidden'; end if;
  if not has_table_privilege('service_role','public.shadow_ai_manual_authorizations','SELECT,INSERT,UPDATE,DELETE') then raise exception 'service_role missing'; end if;
  if to_regprocedure('public.authorize_shadow_ai_manual_message(uuid,uuid,text,text,integer)') is null or to_regprocedure('public.consume_shadow_ai_manual_authorization(uuid,uuid,uuid,text,text)') is null or to_regprocedure('public.revoke_shadow_ai_manual_authorization(uuid)') is null then raise exception 'RPC missing'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='shadow_ai_manual_authorizations' and (qual ilike '%true%' or with_check ilike '%true%')) then raise exception 'open policy forbidden'; end if;
end $$;
select 'P3 manual authorizations DEV checks passed' as result;
