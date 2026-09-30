create table if not exists public.admin_agent_v2_shadow_runs (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.shadow_messages(id) on delete cascade,
  conversation_id uuid not null references public.shadow_conversations(id) on delete cascade,
  session_id text not null,
  status text not null check (status in ('idle','failed')),
  called_tools jsonb not null default '[]'::jsonb,
  proposed_response text null,
  latency_ms integer null check (latency_ms is null or latency_ms >= 0),
  error_code text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);
create index if not exists admin_agent_v2_shadow_runs_created_idx
  on public.admin_agent_v2_shadow_runs(created_at desc);
alter table public.admin_agent_v2_shadow_runs enable row level security;
revoke all on public.admin_agent_v2_shadow_runs from public,anon,authenticated;
grant select,insert,update on public.admin_agent_v2_shadow_runs to service_role;
comment on table public.admin_agent_v2_shadow_runs is
  'Resultados automáticos read-only de Administradora IA V2; nunca implica envío a Respond.';
