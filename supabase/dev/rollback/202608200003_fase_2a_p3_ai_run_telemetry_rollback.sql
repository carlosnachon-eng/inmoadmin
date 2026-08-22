begin;
do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='telemetry_json')
     and col_description('public.shadow_ai_runs'::regclass, (select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname='telemetry_json' and not attisdropped)) is distinct from 'dev-bootstrap:202608200003:fase-2a-p3-ai-run-telemetry' then raise exception 'telemetry_json is not owned by this bootstrap'; end if;
end $$;
alter table public.shadow_ai_runs drop column if exists telemetry_json;
commit;
