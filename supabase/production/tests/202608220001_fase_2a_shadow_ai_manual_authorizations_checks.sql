-- Read-only Production checks. Run only after the migration is explicitly authorized/applied.
do $$ begin
  if to_regclass('public.shadow_ai_manual_authorizations') is null then raise exception 'authorization table missing'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='shadow_ai_manual_authorizations' and c.relrowsecurity) then raise exception 'RLS disabled'; end if;
  if has_table_privilege('anon','public.shadow_ai_manual_authorizations','SELECT') or has_table_privilege('anon','public.shadow_ai_manual_authorizations','INSERT,UPDATE,DELETE') then raise exception 'anon privilege leak'; end if;
  if has_table_privilege('authenticated','public.shadow_ai_manual_authorizations','INSERT,UPDATE,DELETE') then raise exception 'authenticated write leak'; end if;
  if not has_table_privilege('authenticated','public.shadow_ai_manual_authorizations','SELECT') then raise exception 'authorized read grant missing'; end if;
  if not has_table_privilege('service_role','public.shadow_ai_manual_authorizations','SELECT,INSERT,UPDATE,DELETE') then raise exception 'service_role grants missing'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='shadow_ai_manual_authorizations' and (qual ilike '%true%' or with_check ilike '%true%')) then raise exception 'open policy forbidden'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='shadow_ai_manual_authorizations' and policyname='shadow_ai_manual_authorizations_authorized_select') then raise exception 'authorized select policy missing'; end if;
  if to_regprocedure('public.authorize_shadow_ai_manual_message(uuid,uuid,text,text,integer)') is null
     or to_regprocedure('public.consume_shadow_ai_manual_authorization(uuid,uuid,uuid,text,text)') is null
     or to_regprocedure('public.revoke_shadow_ai_manual_authorization(uuid)') is null then raise exception 'RPC missing'; end if;
  if has_function_privilege('anon','public.authorize_shadow_ai_manual_message(uuid,uuid,text,text,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.consume_shadow_ai_manual_authorization(uuid,uuid,uuid,text,text)','EXECUTE') then raise exception 'RPC exposed'; end if;
  if not has_function_privilege('service_role','public.consume_shadow_ai_manual_authorization(uuid,uuid,uuid,text,text)','EXECUTE') then raise exception 'service_role RPC grant missing'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='shadow_ai_manual_authorizations_run_uidx') then raise exception 'run uniqueness missing'; end if;
end $$;

select jsonb_build_object(
  'authorizations',count(*),
  'active',count(*) filter(where consumed_at is null and revoked_at is null and expires_at>now()),
  'consumed',count(*) filter(where consumed_at is not null),
  'revoked',count(*) filter(where revoked_at is not null),
  'expired',count(*) filter(where consumed_at is null and revoked_at is null and expires_at<=now())
) as manual_authorization_counts
from public.shadow_ai_manual_authorizations;
