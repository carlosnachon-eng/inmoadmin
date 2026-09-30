create table if not exists public.sales_agent_v2_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  external_message_id text null,
  respond_contact_id text not null,
  channel_id text not null,
  occurred_at timestamptz not null,
  sanitized_text text not null check (char_length(sanitized_text) <= 2000),
  sanitization_changed boolean not null default false,
  status text not null default 'captured'
    check (status in ('captured','processed','failed','skipped')),
  created_at timestamptz not null default now()
);

create index if not exists sales_agent_v2_inbound_messages_status_idx
  on public.sales_agent_v2_inbound_messages(status,occurred_at);

create table if not exists public.sales_agent_v2_shadow_runs (
  id uuid primary key default gen_random_uuid(),
  inbound_message_id uuid not null unique references public.sales_agent_v2_inbound_messages(id) on delete cascade,
  session_id text not null,
  status text not null check (status in ('idle','failed')),
  called_tools jsonb not null default '[]'::jsonb,
  proposed_response text null,
  latency_ms integer null,
  error_code text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

alter table public.sales_agent_v2_inbound_messages enable row level security;
alter table public.sales_agent_v2_shadow_runs enable row level security;
revoke all on public.sales_agent_v2_inbound_messages from public,anon,authenticated;
revoke all on public.sales_agent_v2_shadow_runs from public,anon,authenticated;
grant select,insert,update on public.sales_agent_v2_inbound_messages to service_role;
grant select,insert,update on public.sales_agent_v2_shadow_runs to service_role;
