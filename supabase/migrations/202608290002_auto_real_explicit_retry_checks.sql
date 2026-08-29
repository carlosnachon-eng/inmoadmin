do $$ begin
  if not exists(select 1 from pg_class where oid='public.shadow_ai_explicit_retry_audit'::regclass and relrowsecurity) then raise exception 'retry audit RLS must be enabled'; end if;
  if has_table_privilege('anon','public.shadow_ai_explicit_retry_audit','SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.shadow_ai_explicit_retry_audit','SELECT,INSERT,UPDATE,DELETE') then raise exception 'client retry audit access forbidden'; end if;
  if not has_table_privilege('service_role','public.shadow_ai_explicit_retry_audit','SELECT,INSERT') then raise exception 'service_role retry audit allowlist missing'; end if;
  if has_table_privilege('service_role','public.shadow_ai_explicit_retry_audit','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'retry audit must be append-only'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='shadow_ai_runs_explicit_retry_once_uidx') then raise exception 'retry idempotency index missing'; end if;
  if exists(select 1 from public.shadow_ai_runs where parent_run_id is not null and (retry_reason<>'explicit_user_authorized' or retry_of_run_id is distinct from parent_run_id)) then raise exception 'invalid explicit retry row'; end if;
end $$;
