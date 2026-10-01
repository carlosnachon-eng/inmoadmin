alter table public.sales_agent_v2_shadow_runs
  add column if not exists model text null,
  add column if not exists input_tokens integer null,
  add column if not exists output_tokens integer null,
  add column if not exists total_tokens integer null,
  add column if not exists estimated_cost_usd numeric(14,8) null;

alter table public.owner_agent_v1_runs
  add column if not exists model text null,
  add column if not exists input_tokens integer null,
  add column if not exists output_tokens integer null,
  add column if not exists total_tokens integer null,
  add column if not exists estimated_cost_usd numeric(14,8) null;

alter table public.legal_agent_v1_runs
  add column if not exists model text null,
  add column if not exists input_tokens integer null,
  add column if not exists output_tokens integer null,
  add column if not exists total_tokens integer null,
  add column if not exists estimated_cost_usd numeric(14,8) null;

create index if not exists sales_agent_v2_shadow_runs_completed_usage_idx
  on public.sales_agent_v2_shadow_runs(completed_at) where total_tokens is not null;
create index if not exists owner_agent_v1_runs_completed_usage_idx
  on public.owner_agent_v1_runs(completed_at) where total_tokens is not null;
create index if not exists legal_agent_v1_runs_completed_usage_idx
  on public.legal_agent_v1_runs(completed_at) where total_tokens is not null;