create table if not exists public.partner_participants (
  id uuid primary key default gen_random_uuid(),
  partner_agency_id uuid not null references public.partner_agencies(id) on delete cascade,
  partner_operation_id uuid not null references public.partner_operations(id) on delete cascade,
  role text not null check (role in ('propietario_adicional', 'inquilino_adicional', 'obligado_solidario')),
  nombre text,
  email text,
  telefono text,
  status text not null default 'pendiente' check (status in ('pendiente', 'recibido', 'observado', 'cancelado')),
  submission_record_id uuid,
  submission_table text,
  data_json jsonb not null default '{}'::jsonb,
  docs_json jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_partner_participants_operation on public.partner_participants(partner_operation_id);
create index if not exists idx_partner_participants_agency on public.partner_participants(partner_agency_id);
create index if not exists idx_partner_participants_status on public.partner_participants(status);

alter table public.partner_participants enable row level security;

drop policy if exists partner_participants_no_direct_access on public.partner_participants;
create policy partner_participants_no_direct_access
on public.partner_participants
for all
using (false)
with check (false);
