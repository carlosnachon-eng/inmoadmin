create table if not exists public.legal_agent_v1_handoffs (
  id uuid primary key default gen_random_uuid(),
  inbound_message_id uuid not null unique references public.legal_agent_v1_inbound_messages(id) on delete cascade,
  respond_contact_id text not null,
  channel_id text not null,
  reason text not null,
  summary text not null,
  status text not null default 'ready_for_legal'
    check (status in ('ready_for_legal','assignment_requested','assigned','taken','resolved','cancelled','failed')),
  assignment_requested_at timestamptz null,
  assignment_error_code text null,
  ack_message_id text null,
  ack_sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.legal_agent_v1_handoffs enable row level security;
create index if not exists legal_agent_v1_handoffs_status_idx
  on public.legal_agent_v1_handoffs(status,created_at desc);