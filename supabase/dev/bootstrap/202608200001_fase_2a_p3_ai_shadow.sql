begin;
do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if obj_description('public.shadow_ai_runs'::regclass) not like 'dev-bootstrap:202608180005:%' then raise exception 'P0 DEV marker missing'; end if;
end $$;

alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_status_check;
alter table public.shadow_ai_runs
  add column if not exists model text,
  add column if not exists prompt_version text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists latency_ms integer check (latency_ms >= 0),
  add column if not exists input_tokens integer check (input_tokens >= 0),
  add column if not exists output_tokens integer check (output_tokens >= 0),
  add column if not exists estimated_cost_usd numeric(12,8) check (estimated_cost_usd >= 0),
  add column if not exists error_sanitized text check (char_length(error_sanitized) <= 180),
  add column if not exists idempotency_key text;
alter table public.shadow_ai_runs add constraint shadow_ai_runs_status_check check (status in ('not_executed','running','completed','error','timeout'));
create unique index if not exists shadow_ai_runs_idempotency_idx on public.shadow_ai_runs(idempotency_key) where idempotency_key is not null;

alter table public.shadow_ai_decisions drop constraint if exists shadow_ai_decisions_status_check;
alter table public.shadow_ai_decisions
  add column if not exists intent text,
  add column if not exists urgency text check (urgency in ('low','normal','high','critical')),
  add column if not exists proposed_action text check (char_length(proposed_action) <= 500),
  add column if not exists proposed_response text check (char_length(proposed_response) <= 1000),
  add column if not exists confidence numeric(4,3) check (confidence between 0 and 1),
  add column if not exists requires_human boolean,
  add column if not exists escalation_reason text check (char_length(escalation_reason) <= 500),
  add column if not exists decision_json jsonb not null default '{}'::jsonb,
  add column if not exists tool_summary jsonb not null default '[]'::jsonb;
alter table public.shadow_ai_decisions add constraint shadow_ai_decisions_status_check check (status in ('not_executed','completed'));

alter table public.shadow_human_evaluations drop constraint if exists shadow_human_evaluations_classification_check;
alter table public.shadow_human_evaluations add constraint shadow_human_evaluations_classification_check check (classification in ('correct','partially_correct','wrong_context','wrong_intent','wrong_action','wrong_response','unsafe'));

comment on column public.shadow_ai_runs.idempotency_key is 'dev-bootstrap:202608200001:fase-2a-p3-ai-shadow';
comment on column public.shadow_ai_decisions.decision_json is 'dev-bootstrap:202608200001:fase-2a-p3-ai-shadow';
alter table public.shadow_ai_runs enable row level security;
alter table public.shadow_ai_decisions enable row level security;
revoke all on public.shadow_ai_runs, public.shadow_ai_decisions from public, anon;
grant all on public.shadow_ai_runs, public.shadow_ai_decisions to service_role;
commit;
