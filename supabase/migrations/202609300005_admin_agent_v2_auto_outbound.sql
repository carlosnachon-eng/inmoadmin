create table if not exists public.admin_agent_v2_auto_outbound (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.shadow_messages(id) on delete restrict,
  conversation_id uuid not null references public.shadow_conversations(id) on delete restrict,
  respond_contact_id text not null,
  case_kind text not null check (case_kind in ('contract_end_date')),
  status text not null check (status in ('processing','sent','blocked','failed','superseded')),
  proposed_message text null,
  provider_message_id text null,
  error_code text null,
  created_at timestamptz not null default now(),
  sent_at timestamptz null,
  completed_at timestamptz null
);
create index if not exists admin_agent_v2_auto_outbound_created_idx
  on public.admin_agent_v2_auto_outbound(created_at desc);
alter table public.admin_agent_v2_auto_outbound enable row level security;
revoke all on public.admin_agent_v2_auto_outbound from public,anon,authenticated;
grant select,insert,update on public.admin_agent_v2_auto_outbound to service_role;
comment on table public.admin_agent_v2_auto_outbound is
  'Carril automático fail-closed de V2. Primera política: fecha de término contractual revalidada en ERP.';
