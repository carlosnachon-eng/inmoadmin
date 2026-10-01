create table if not exists public.sales_agent_v2_handoffs (
  id uuid primary key default gen_random_uuid(),
  respond_contact_id text not null,
  channel_id text not null,
  inbound_message_id uuid not null unique references public.sales_agent_v2_inbound_messages(id) on delete restrict,
  shadow_run_id uuid null references public.sales_agent_v2_shadow_runs(id) on delete set null,
  status text not null default 'ready_for_advisor'
    check (status in ('ready_for_advisor','assigned','taken','resolved','cancelled')),
  reason text not null check (reason in (
    'appointment_intent',
    'reservation_intent',
    'negotiation_intent',
    'financing_intent',
    'specific_property_high_interest',
    'human_requested'
  )),
  priority text not null default 'high' check (priority in ('normal','high','urgent')),
  summary text not null check (char_length(summary) between 1 and 1200),
  assigned_profile_id uuid null references public.profiles(id),
  assigned_at timestamptz null,
  taken_at timestamptz null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sales_agent_v2_handoffs enable row level security;
revoke all on public.sales_agent_v2_handoffs from public,anon,authenticated;
grant select,insert,update on public.sales_agent_v2_handoffs to service_role;

create index if not exists sales_agent_v2_handoffs_open_idx
  on public.sales_agent_v2_handoffs(status,priority,created_at desc);
create index if not exists sales_agent_v2_handoffs_contact_idx
  on public.sales_agent_v2_handoffs(respond_contact_id,created_at desc);
