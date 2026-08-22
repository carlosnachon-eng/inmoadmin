-- Production readiness P3: schema final de IA Shadow, apagada por flags de aplicación.
-- Requiere 202608190003 y 202608210002. No ejecuta IA, no seed, no backfill.
begin;
do $$ begin
  if to_regclass('public.shadow_ai_runs') is null or to_regclass('public.shadow_ai_decisions') is null or to_regclass('public.shadow_operational_events') is null then
    raise exception 'Dependencias Production Shadow incompletas';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name in ('model','execution_state','campaign_id','operational_event_id','input_kind')) then
    raise exception 'Colisión o instalación parcial P3; detener y auditar';
  end if;
  if exists(select 1 from public.shadow_ai_runs where status<>'not_executed') or exists(select 1 from public.shadow_ai_decisions where status<>'not_executed') then
    raise exception 'Estado AI Production inesperado; detener';
  end if;
end $$;

alter table public.shadow_ai_runs drop constraint shadow_ai_runs_status_check;
alter table public.shadow_ai_runs alter column message_id drop not null;
alter table public.shadow_ai_runs
  add column model text,
  add column prompt_version text,
  add column started_at timestamptz,
  add column completed_at timestamptz,
  add column latency_ms integer check(latency_ms>=0),
  add column input_tokens integer check(input_tokens>=0),
  add column output_tokens integer check(output_tokens>=0),
  add column estimated_cost_usd numeric(12,8) check(estimated_cost_usd>=0),
  add column error_sanitized text check(char_length(error_sanitized)<=180),
  add column idempotency_key text,
  add column retry_of_run_id uuid references public.shadow_ai_runs(id) on delete restrict,
  add column attempt_number smallint not null default 1 check(attempt_number between 1 and 3),
  add column telemetry_json jsonb not null default '{}'::jsonb check(jsonb_typeof(telemetry_json)='object'),
  add column execution_state text not null default 'created',
  add column current_round smallint not null default 0,
  add column max_rounds smallint not null default 3,
  add column schema_version text,
  add column round_state_json jsonb not null default '{"rounds":[]}'::jsonb,
  add column evidence_ledger jsonb not null default '[]'::jsonb,
  add column tool_results_json jsonb not null default '[]'::jsonb,
  add column grounding_state_json jsonb not null default '{}'::jsonb,
  add column state_updated_at timestamptz not null default now(),
  add column campaign_id text,
  add column operational_event_id uuid references public.shadow_operational_events(id) on delete restrict,
  add column input_kind text not null default 'conversational_message';
alter table public.shadow_ai_runs add constraint shadow_ai_runs_status_check check(status in ('not_executed','running','completed','error','timeout'));
alter table public.shadow_ai_runs add constraint shadow_ai_runs_execution_state_check check(execution_state in ('created','model_round_running','awaiting_tool_execution','awaiting_model_round','completed','blocked','error','timeout'));
alter table public.shadow_ai_runs add constraint shadow_ai_runs_round_check check(current_round between 0 and 3 and max_rounds between 1 and 3 and current_round<=max_rounds);
alter table public.shadow_ai_runs add constraint shadow_ai_runs_json_state_check check(jsonb_typeof(round_state_json)='object' and jsonb_typeof(evidence_ledger)='array' and jsonb_typeof(tool_results_json)='array' and jsonb_typeof(grounding_state_json)='object');
alter table public.shadow_ai_runs add constraint shadow_ai_runs_qa_campaign_check check(campaign_id is null or campaign_id ~ '^[a-z0-9][a-z0-9._-]{2,80}$');
alter table public.shadow_ai_runs add constraint shadow_ai_runs_input_kind_check check((input_kind='conversational_message' and message_id is not null and operational_event_id is null) or (input_kind='operational_event' and message_id is null and operational_event_id is not null));
create unique index shadow_ai_runs_idempotency_idx on public.shadow_ai_runs(idempotency_key) where idempotency_key is not null and status in ('running','completed');
create index shadow_ai_runs_retry_of_idx on public.shadow_ai_runs(retry_of_run_id) where retry_of_run_id is not null;
create index shadow_ai_runs_execution_state_updated_idx on public.shadow_ai_runs(execution_state,state_updated_at desc);
create index shadow_ai_runs_qa_campaign_idx on public.shadow_ai_runs(campaign_id,model,prompt_version,message_id,created_at desc) where campaign_id is not null;
create unique index shadow_ai_runs_operational_completed_uidx on public.shadow_ai_runs(operational_event_id,model,prompt_version) where operational_event_id is not null and status='completed';
create index shadow_ai_runs_operational_event_idx on public.shadow_ai_runs(operational_event_id,created_at desc) where operational_event_id is not null;

alter table public.shadow_ai_decisions drop constraint shadow_ai_decisions_status_check;
alter table public.shadow_ai_decisions
  add column intent text,
  add column urgency text check(urgency in ('low','normal','high','critical')),
  add column proposed_action text check(char_length(proposed_action)<=500),
  add column proposed_response text check(char_length(proposed_response)<=1000),
  add column confidence numeric(4,3) check(confidence between 0 and 1),
  add column requires_human boolean,
  add column escalation_reason text check(char_length(escalation_reason)<=500),
  add column decision_json jsonb not null default '{}'::jsonb,
  add column tool_summary jsonb not null default '[]'::jsonb;
alter table public.shadow_ai_decisions add constraint shadow_ai_decisions_status_check check(status in ('not_executed','completed'));

alter table public.shadow_human_evaluations drop constraint shadow_human_evaluations_classification_check;
alter table public.shadow_human_evaluations add constraint shadow_human_evaluations_classification_check check(classification in ('correct','partially_correct','wrong_context','wrong_intent','wrong_action','wrong_response','unsafe'));

comment on column public.shadow_ai_runs.operational_event_id is 'production-migration:202608210003:p3-operational-input';
comment on column public.shadow_ai_runs.input_kind is 'production-migration:202608210003:messages-and-operational-events-separated';
alter table public.shadow_ai_runs enable row level security;
alter table public.shadow_ai_decisions enable row level security;
revoke all on public.shadow_ai_runs,public.shadow_ai_decisions from public,anon;
grant all on public.shadow_ai_runs,public.shadow_ai_decisions to service_role;
commit;
