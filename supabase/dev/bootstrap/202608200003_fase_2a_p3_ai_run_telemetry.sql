begin;
do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if obj_description('public.shadow_ai_runs'::regclass) not like 'dev-bootstrap:202608180005:%' then raise exception 'P0 DEV marker missing'; end if;
  if col_description('public.shadow_ai_runs'::regclass, (select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname='attempt_number' and not attisdropped)) is distinct from 'dev-bootstrap:202608200002:fase-2a-p3-ai-run-retries' then raise exception 'P3 retries DEV marker missing'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='telemetry_json' and udt_name <> 'jsonb') then raise exception 'Incompatible telemetry_json'; end if;
end $$;

alter table public.shadow_ai_runs
  add column if not exists telemetry_json jsonb not null default '{}'::jsonb
  check (jsonb_typeof(telemetry_json) = 'object');

do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='telemetry_json' and (udt_name <> 'jsonb' or is_nullable <> 'NO' or column_default is distinct from '''{}''::jsonb')) then raise exception 'Incompatible telemetry_json definition'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.shadow_ai_runs'::regclass and contype='c' and pg_get_constraintdef(oid) like '%jsonb_typeof(telemetry_json)%object%') then raise exception 'telemetry_json object check missing'; end if;
end $$;

comment on column public.shadow_ai_runs.telemetry_json is 'dev-bootstrap:202608200003:fase-2a-p3-ai-run-telemetry';
alter table public.shadow_ai_runs enable row level security;
revoke all on public.shadow_ai_runs from public, anon;
grant all on public.shadow_ai_runs to service_role;
commit;
