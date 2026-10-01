create table if not exists public.respond_appointment_sync (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  respond_contact_id text not null,
  lifecycle text not null,
  status text not null default 'pending'
    check (status in ('pending','created','needs_confirmation','skipped','failed')),
  advisor_profile_id uuid null references public.profiles(id),
  cliente_id uuid null references public.clientes(id),
  propiedad_id uuid null references public.propiedades(id),
  appointment_at timestamptz null,
  cita_id uuid null references public.citas(id),
  source_message_at timestamptz null,
  source_message_excerpt text null,
  error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.respond_appointment_sync enable row level security;
create index if not exists respond_appointment_sync_pending_idx
  on public.respond_appointment_sync(status,created_at);