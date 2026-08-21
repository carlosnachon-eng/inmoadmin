begin;
do $$ declare c text; begin
  if current_setting('app.settings.environment',true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if exists(select 1 from public.shadow_ai_runs where execution_state in ('model_round_running','awaiting_tool_execution','awaiting_model_round')) then raise exception 'Cannot rollback active state-machine runs'; end if;
  foreach c in array array['execution_state','current_round','max_rounds','schema_version','round_state_json','evidence_ledger','tool_results_json','grounding_state_json','state_updated_at'] loop
    if col_description('public.shadow_ai_runs'::regclass,(select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname=c and not attisdropped)) not like 'dev-bootstrap:202608200004:%' then raise exception 'Column % is not owned by this bootstrap',c; end if;
  end loop;
end $$;
drop index if exists public.shadow_ai_runs_execution_state_updated_idx;
alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_round_state_json_check;
alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_round_check;
alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_execution_state_check;
alter table public.shadow_ai_runs drop column grounding_state_json, drop column tool_results_json, drop column evidence_ledger, drop column round_state_json, drop column schema_version, drop column max_rounds, drop column current_round, drop column state_updated_at, drop column execution_state;
commit;
