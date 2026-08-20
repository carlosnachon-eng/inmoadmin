do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='retry_of_run_id' and udt_name='uuid') then raise exception 'retry_of_run_id missing/incompatible'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='attempt_number' and udt_name='int2' and is_nullable='NO' and column_default like '1%') then raise exception 'attempt_number missing/incompatible'; end if;
  if col_description('public.shadow_ai_runs'::regclass, (select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname='retry_of_run_id' and not attisdropped)) is distinct from 'dev-bootstrap:202608200002:fase-2a-p3-ai-run-retries' then raise exception 'retry marker missing'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='shadow_ai_runs_idempotency_idx' and indexdef ilike '%status%running%completed%') then raise exception 'active/completed idempotency index missing'; end if;
  if has_table_privilege('anon','public.shadow_ai_runs','select') or has_table_privilege('anon','public.shadow_ai_runs','insert') then raise exception 'anon privilege detected'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='shadow_ai_runs' and (qual ilike '%true%' or with_check ilike '%true%')) then raise exception 'open policy detected'; end if;
end $$;
