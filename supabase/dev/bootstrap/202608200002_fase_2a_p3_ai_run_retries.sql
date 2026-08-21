begin;
do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if obj_description('public.shadow_ai_runs'::regclass) not like 'dev-bootstrap:202608180005:%' then raise exception 'P0 DEV marker missing'; end if;
  if col_description('public.shadow_ai_runs'::regclass, (select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname='idempotency_key' and not attisdropped)) is distinct from 'dev-bootstrap:202608200001:fase-2a-p3-ai-shadow' then raise exception 'P3 DEV marker missing'; end if;
end $$;

alter table public.shadow_ai_runs
  add column if not exists retry_of_run_id uuid references public.shadow_ai_runs(id) on delete restrict,
  add column if not exists attempt_number smallint not null default 1;

do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='retry_of_run_id' and udt_name <> 'uuid') then raise exception 'Incompatible retry_of_run_id'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='attempt_number' and udt_name <> 'int2') then raise exception 'Incompatible attempt_number'; end if;
end $$;

alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_attempt_number_check;
alter table public.shadow_ai_runs add constraint shadow_ai_runs_attempt_number_check check (attempt_number between 1 and 3);
drop index if exists public.shadow_ai_runs_idempotency_idx;
create unique index shadow_ai_runs_idempotency_idx on public.shadow_ai_runs(idempotency_key)
  where idempotency_key is not null and status in ('running','completed');
create index if not exists shadow_ai_runs_retry_of_idx on public.shadow_ai_runs(retry_of_run_id)
  where retry_of_run_id is not null;
comment on column public.shadow_ai_runs.retry_of_run_id is 'dev-bootstrap:202608200002:fase-2a-p3-ai-run-retries';
comment on column public.shadow_ai_runs.attempt_number is 'dev-bootstrap:202608200002:fase-2a-p3-ai-run-retries';
alter table public.shadow_ai_runs enable row level security;
revoke all on public.shadow_ai_runs from public, anon;
grant all on public.shadow_ai_runs to service_role;
commit;
