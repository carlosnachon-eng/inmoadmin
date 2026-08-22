begin;
do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if obj_description('public.shadow_ai_runs'::regclass) not like 'dev-bootstrap:202608180005:%' then raise exception 'P0 DEV marker missing'; end if;
  if col_description('public.shadow_ai_runs'::regclass, (select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname='telemetry_json' and not attisdropped)) is distinct from 'dev-bootstrap:202608200003:fase-2a-p3-ai-run-telemetry' then raise exception 'P3 telemetry DEV marker missing'; end if;
end $$;

alter table public.shadow_ai_runs
  add column if not exists execution_state text not null default 'created',
  add column if not exists current_round smallint not null default 0,
  add column if not exists max_rounds smallint not null default 3,
  add column if not exists schema_version text,
  add column if not exists round_state_json jsonb not null default '{"rounds":[]}'::jsonb,
  add column if not exists evidence_ledger jsonb not null default '[]'::jsonb,
  add column if not exists tool_results_json jsonb not null default '[]'::jsonb,
  add column if not exists grounding_state_json jsonb not null default '{}'::jsonb,
  add column if not exists state_updated_at timestamptz not null default now();

do $$ declare c text; begin
  foreach c in array array['execution_state','current_round','max_rounds','schema_version','round_state_json','evidence_ledger','tool_results_json','grounding_state_json','state_updated_at'] loop
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name=c) then raise exception 'Missing state-machine column %',c; end if;
  end loop;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name in ('round_state_json','evidence_ledger','tool_results_json','grounding_state_json') and udt_name <> 'jsonb') then raise exception 'Incompatible state-machine JSON column'; end if;
end $$;

alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_execution_state_check;
alter table public.shadow_ai_runs add constraint shadow_ai_runs_execution_state_check check (execution_state in ('created','model_round_running','awaiting_tool_execution','awaiting_model_round','completed','blocked','error','timeout'));
alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_round_check;
alter table public.shadow_ai_runs add constraint shadow_ai_runs_round_check check (current_round between 0 and 3 and max_rounds between 1 and 3 and current_round <= max_rounds);
alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_round_state_json_check;
alter table public.shadow_ai_runs add constraint shadow_ai_runs_round_state_json_check check (jsonb_typeof(round_state_json)='object' and jsonb_typeof(evidence_ledger)='array' and jsonb_typeof(tool_results_json)='array' and jsonb_typeof(grounding_state_json)='object');
create index if not exists shadow_ai_runs_execution_state_updated_idx on public.shadow_ai_runs(execution_state,state_updated_at desc);

update public.shadow_ai_runs set execution_state=case status when 'completed' then 'completed' when 'error' then 'error' when 'timeout' then 'timeout' when 'running' then 'error' else 'error' end,
  state_updated_at=coalesce(completed_at,started_at,created_at,now()), schema_version=coalesce(schema_version,telemetry_json->>'schema_version')
where execution_state='created' and status <> 'not_executed';

comment on column public.shadow_ai_runs.execution_state is 'dev-bootstrap:202608200004:fase-2a-p3-ai-state-machine';
comment on column public.shadow_ai_runs.current_round is 'dev-bootstrap:202608200004:fase-2a-p3-ai-state-machine';
comment on column public.shadow_ai_runs.max_rounds is 'dev-bootstrap:202608200004:fase-2a-p3-ai-state-machine';
comment on column public.shadow_ai_runs.schema_version is 'dev-bootstrap:202608200004:fase-2a-p3-ai-state-machine';
comment on column public.shadow_ai_runs.round_state_json is 'dev-bootstrap:202608200004:fase-2a-p3-ai-state-machine:no-raw-provider-output';
comment on column public.shadow_ai_runs.evidence_ledger is 'dev-bootstrap:202608200004:fase-2a-p3-ai-state-machine';
comment on column public.shadow_ai_runs.tool_results_json is 'dev-bootstrap:202608200004:fase-2a-p3-ai-state-machine:sanitized-read-only';
comment on column public.shadow_ai_runs.grounding_state_json is 'dev-bootstrap:202608200004:fase-2a-p3-ai-state-machine';
comment on column public.shadow_ai_runs.state_updated_at is 'dev-bootstrap:202608200004:fase-2a-p3-ai-state-machine';
alter table public.shadow_ai_runs enable row level security;
revoke all on public.shadow_ai_runs from public, anon;
grant all on public.shadow_ai_runs to service_role;
commit;
