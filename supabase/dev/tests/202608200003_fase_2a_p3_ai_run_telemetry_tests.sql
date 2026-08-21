begin;
do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='telemetry_json' and udt_name='jsonb' and is_nullable='NO') then raise exception 'telemetry_json missing or incompatible'; end if;
  if col_description('public.shadow_ai_runs'::regclass, (select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname='telemetry_json' and not attisdropped)) is distinct from 'dev-bootstrap:202608200003:fase-2a-p3-ai-run-telemetry' then raise exception 'telemetry marker missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.shadow_ai_runs'::regclass) then raise exception 'RLS disabled'; end if;
  if has_table_privilege('anon','public.shadow_ai_runs','select') or has_table_privilege('anon','public.shadow_ai_runs','insert') or has_table_privilege('authenticated','public.shadow_ai_runs','insert') then raise exception 'unsafe grants'; end if;
end $$;
rollback;
