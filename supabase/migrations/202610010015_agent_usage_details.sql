alter table public.sales_agent_v2_shadow_runs
  add column if not exists cached_input_tokens integer null,
  add column if not exists reasoning_tokens integer null;
alter table public.owner_agent_v1_runs
  add column if not exists cached_input_tokens integer null,
  add column if not exists reasoning_tokens integer null;
alter table public.legal_agent_v1_runs
  add column if not exists cached_input_tokens integer null,
  add column if not exists reasoning_tokens integer null;