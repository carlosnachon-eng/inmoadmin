do $$ declare c text; begin
  foreach c in array array['execution_state','current_round','max_rounds','schema_version','round_state_json','evidence_ledger','tool_results_json','grounding_state_json','state_updated_at'] loop
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name=c) then raise exception 'state-machine column missing: %',c; end if;
  end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.shadow_ai_runs'::regclass and conname='shadow_ai_runs_execution_state_check') then raise exception 'state check missing'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='shadow_ai_runs_execution_state_updated_idx') then raise exception 'state index missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.shadow_ai_runs'::regclass) then raise exception 'RLS disabled'; end if;
  if has_table_privilege('anon','public.shadow_ai_runs','select') or has_table_privilege('anon','public.shadow_ai_runs','insert') or has_table_privilege('anon','public.shadow_ai_runs','update') or has_table_privilege('anon','public.shadow_ai_runs','delete') then raise exception 'anon has unsafe grants'; end if;
  if has_table_privilege('authenticated','public.shadow_ai_runs','insert') or has_table_privilege('authenticated','public.shadow_ai_runs','update') or has_table_privilege('authenticated','public.shadow_ai_runs','delete') then raise exception 'authenticated has unsafe writes'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='shadow_ai_runs' and (qual='true' or with_check='true')) then raise exception 'open policy found'; end if;
  if col_description('public.shadow_ai_runs'::regclass,(select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname='execution_state' and not attisdropped)) is distinct from 'dev-bootstrap:202608200004:fase-2a-p3-ai-state-machine' then raise exception 'ownership marker missing'; end if;
end $$;
