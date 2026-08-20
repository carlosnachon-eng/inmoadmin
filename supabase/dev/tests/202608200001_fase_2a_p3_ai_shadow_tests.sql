do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='shadow_ai_runs_idempotency_idx') then raise exception 'idempotency index missing'; end if;
  if has_table_privilege('anon','public.shadow_ai_runs','select') or has_table_privilege('anon','public.shadow_ai_decisions','select') then raise exception 'anon access'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in ('shadow_ai_runs','shadow_ai_decisions') and (qual ~* '^\s*true\s*$' or with_check ~* '^\s*true\s*$')) then raise exception 'open policy'; end if;
  if not exists(select 1 from pg_class where oid='public.shadow_ai_runs'::regclass and relrowsecurity) then raise exception 'runs RLS off'; end if;
  if not exists(select 1 from pg_class where oid='public.shadow_ai_decisions'::regclass and relrowsecurity) then raise exception 'decisions RLS off'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.shadow_human_evaluations'::regclass and conname='shadow_human_evaluations_classification_check' and pg_get_constraintdef(oid) like '%wrong_action%' and pg_get_constraintdef(oid) like '%unsafe%') then raise exception 'P3 evaluation labels missing'; end if;
end $$;
