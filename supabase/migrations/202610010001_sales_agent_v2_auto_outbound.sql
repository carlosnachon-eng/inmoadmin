create table if not exists public.sales_agent_v2_auto_outbound (
  id uuid primary key default gen_random_uuid(),
  inbound_message_id uuid not null unique references public.sales_agent_v2_inbound_messages(id) on delete restrict,
  shadow_run_id uuid not null unique references public.sales_agent_v2_shadow_runs(id) on delete restrict,
  respond_contact_id text not null,
  channel_id text not null,
  case_kind text not null check (case_kind in (
    'greeting_qualification',
    'coverage',
    'inventory_search',
    'simple_followup',
    'property_interest'
  )),
  status text not null default 'processing'
    check (status in ('processing','sent','blocked','failed','superseded')),
  proposed_message text not null check (char_length(proposed_message) between 1 and 1200),
  provider_message_id text null,
  error_code text null,
  created_at timestamptz not null default now(),
  sent_at timestamptz null,
  completed_at timestamptz null
);

alter table public.sales_agent_v2_auto_outbound enable row level security;
revoke all on public.sales_agent_v2_auto_outbound from public,anon,authenticated;
grant select,insert,update on public.sales_agent_v2_auto_outbound to service_role;

create index if not exists sales_agent_v2_auto_outbound_status_idx
  on public.sales_agent_v2_auto_outbound(status,created_at desc);
