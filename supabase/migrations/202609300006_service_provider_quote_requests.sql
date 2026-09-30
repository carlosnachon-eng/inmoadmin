create table if not exists public.service_provider_quote_requests (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.maintenance_tickets(id) on delete restrict,
  provider_id uuid not null references public.service_providers(id) on delete restrict,
  respond_contact_id text not null,
  status text not null default 'draft'
    check (status in ('draft','sent','responded','cancelled','failed')),
  request_message text not null check (char_length(request_message) between 10 and 480),
  provider_message_id text null,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  sent_at timestamptz null,
  responded_at timestamptz null,
  response_summary text null,
  error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_provider_quote_requests_ticket_idx
  on public.service_provider_quote_requests(ticket_id,created_at desc);
create index if not exists service_provider_quote_requests_provider_idx
  on public.service_provider_quote_requests(provider_id,created_at desc);

alter table public.service_provider_quote_requests enable row level security;
revoke all on public.service_provider_quote_requests from public,anon,authenticated;
grant select,insert,update on public.service_provider_quote_requests to service_role;

comment on table public.service_provider_quote_requests is
  'Solicitudes de cotización a proveedores externos; envío siempre requiere aprobación humana explícita.';
