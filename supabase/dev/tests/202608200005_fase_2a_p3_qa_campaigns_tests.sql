do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='campaign_id' and udt_name='text' and is_nullable='YES') then raise exception 'campaign_id missing or incompatible'; end if;
  if col_description('public.shadow_ai_runs'::regclass, (select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname='campaign_id' and not attisdropped)) not like 'dev-bootstrap:202608200005:%' then raise exception 'campaign ownership marker missing'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.shadow_ai_runs'::regclass and conname='shadow_ai_runs_qa_campaign_check') then raise exception 'campaign check missing'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='shadow_ai_runs_qa_campaign_idx') then raise exception 'campaign index missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.shadow_ai_runs'::regclass) then raise exception 'RLS disabled'; end if;
  if has_table_privilege('anon','public.shadow_ai_runs','select') or has_table_privilege('anon','public.shadow_ai_runs','insert') or has_table_privilege('anon','public.shadow_ai_runs','update') or has_table_privilege('anon','public.shadow_ai_runs','delete') then raise exception 'anon has unsafe grants'; end if;
  if has_table_privilege('authenticated','public.shadow_ai_runs','insert') or has_table_privilege('authenticated','public.shadow_ai_runs','update') or has_table_privilege('authenticated','public.shadow_ai_runs','delete') then raise exception 'authenticated has unsafe writes'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='shadow_ai_runs' and (qual='true' or with_check='true')) then raise exception 'open policy found'; end if;
end $$;
