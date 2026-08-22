begin;
do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if col_description('public.shadow_ai_runs'::regclass, (select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname='retry_of_run_id' and not attisdropped)) is distinct from 'dev-bootstrap:202608200002:fase-2a-p3-ai-run-retries' then raise exception 'Retry patch not owned by this bootstrap'; end if;
  if exists(select 1 from public.shadow_ai_runs where retry_of_run_id is not null or attempt_number <> 1) then raise exception 'Retry audit exists; preserve it and do not rollback'; end if;
end $$;
drop index if exists public.shadow_ai_runs_retry_of_idx;
drop index if exists public.shadow_ai_runs_idempotency_idx;
create unique index shadow_ai_runs_idempotency_idx on public.shadow_ai_runs(idempotency_key) where idempotency_key is not null;
alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_attempt_number_check;
alter table public.shadow_ai_runs drop column retry_of_run_id, drop column attempt_number;
commit;
