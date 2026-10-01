create table if not exists public.owner_agent_v1_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  external_message_id text null,
  respond_contact_id text not null,
  channel_id text not null,
  occurred_at timestamptz not null,
  sanitized_text text not null,
  status text not null default 'captured'
    check (status in ('captured','processing','processed','failed','skipped')),
  debounce_until timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists owner_agent_v1_inbound_status_idx
  on public.owner_agent_v1_inbound_messages(status,debounce_until,occurred_at);

create table if not exists public.owner_agent_v1_runs (
  id uuid primary key default gen_random_uuid(),
  inbound_message_id uuid not null unique references public.owner_agent_v1_inbound_messages(id) on delete cascade,
  session_id text not null,
  status text not null check (status in ('idle','failed')),
  called_tools jsonb not null default '[]'::jsonb,
  proposed_response text null,
  latency_ms integer null,
  error_code text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.owner_agent_v1_auto_outbound (
  id uuid primary key default gen_random_uuid(),
  inbound_message_id uuid not null unique references public.owner_agent_v1_inbound_messages(id) on delete cascade,
  run_id uuid not null references public.owner_agent_v1_runs(id) on delete cascade,
  respond_contact_id text not null,
  channel_id text not null,
  status text not null check (status in ('processing','sent','failed','superseded')),
  proposed_message text not null,
  provider_message_id text null,
  error_code text null,
  sent_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);

alter table public.owner_agent_v1_inbound_messages enable row level security;
alter table public.owner_agent_v1_runs enable row level security;
alter table public.owner_agent_v1_auto_outbound enable row level security;
