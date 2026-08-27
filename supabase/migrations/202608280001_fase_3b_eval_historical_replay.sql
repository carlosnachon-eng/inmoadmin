begin;

create table if not exists public.shadow_historical_replay_cohorts (
  id uuid primary key default gen_random_uuid(),
  evaluation_mode text not null default 'historical_replay' check (evaluation_mode = 'historical_replay'),
  runtime_version text not null,
  status text not null default 'prepared' check (status in ('prepared','running','completed','partial','cancelled')),
  requested_count integer not null check (requested_count between 1 and 30),
  domain_counts jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.shadow_historical_replay_cases (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.shadow_historical_replay_cohorts(id),
  evaluation_mode text not null default 'historical_replay' check (evaluation_mode = 'historical_replay'),
  historical_turn_key text not null,
  evaluation_runtime_version text not null,
  case_ref text not null,
  case_domain text not null check (case_domain in ('maintenance','payment','administrative_pending')),
  status text not null default 'pending' check (status in ('pending','running','completed','error','not_evaluable')),
  occurred_at timestamptz not null,
  turn_snapshot jsonb not null,
  human_response_snapshot text,
  temporal_grounding text not null check (temporal_grounding in ('current_state','historical_snapshot')),
  identity_grounding text not null check (identity_grounding in ('current_canonical_mapping','unresolved')),
  operational_resolution jsonb,
  conversation_action text check (conversation_action is null or conversation_action in ('ask_missing_information','request_document','clarify_property','clarify_payment_amount','clarify_payment_period','acknowledge_received_information','provide_verified_status','human_handoff','no_message')),
  proposed_message text check (proposed_message is null or char_length(proposed_message) <= 480),
  result_safe jsonb,
  message_safe boolean,
  would_resolve_without_human boolean,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  latency_ms integer,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (historical_turn_key, evaluation_runtime_version)
);

create table if not exists public.shadow_historical_replay_reviews (
  id uuid primary key default gen_random_uuid(),
  replay_case_id uuid not null references public.shadow_historical_replay_cases(id),
  rating text not null check (rating in ('correct','acceptable_with_changes','incorrect','should_escalate','not_evaluable')),
  reason text check (reason is null or reason in ('tone','missing_information','wrong_question','invented_fact','wrong_context','financial_risk','legal_risk','other')),
  reviewed_by uuid not null,
  created_at timestamptz not null default now()
);

alter table public.shadow_historical_replay_cohorts enable row level security;
alter table public.shadow_historical_replay_cases enable row level security;
alter table public.shadow_historical_replay_reviews enable row level security;

revoke all on public.shadow_historical_replay_cohorts from public, anon, authenticated, service_role;
revoke all on public.shadow_historical_replay_cases from public, anon, authenticated, service_role;
revoke all on public.shadow_historical_replay_reviews from public, anon, authenticated, service_role;
grant select, insert, update on public.shadow_historical_replay_cohorts to service_role;
grant select, insert, update on public.shadow_historical_replay_cases to service_role;
grant select, insert on public.shadow_historical_replay_reviews to service_role;

commit;
