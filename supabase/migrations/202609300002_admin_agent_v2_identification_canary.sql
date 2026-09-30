create table if not exists public.admin_agent_v2_identification_canaries (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.shadow_messages(id) on delete restrict,
  conversation_id uuid not null references public.shadow_conversations(id) on delete restrict,
  respond_contact_id text not null,
  status text not null check (status in ('processing','sent','failed','blocked')),
  provider_message_id text null,
  error_code text null,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);
alter table public.admin_agent_v2_identification_canaries enable row level security;
revoke all on public.admin_agent_v2_identification_canaries from public,anon,authenticated;
grant select,insert,update on public.admin_agent_v2_identification_canaries to service_role;
create index if not exists admin_agent_v2_ident_canary_created_idx
  on public.admin_agent_v2_identification_canaries(created_at desc);
comment on table public.admin_agent_v2_identification_canaries is
  'Canary manual 1/1 para solicitar identificación mínima a un contacto Respond no resuelto.';
