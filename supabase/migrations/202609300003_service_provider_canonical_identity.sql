create table if not exists public.service_providers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(trim(display_name)) between 2 and 160),
  provider_type text not null default 'technician'
    check (provider_type in ('technician','company','independent')),
  status text not null default 'active'
    check (status in ('active','inactive','blocked')),
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_provider_specialties (
  provider_id uuid not null references public.service_providers(id) on delete cascade,
  specialty text not null check (char_length(trim(specialty)) between 2 and 80),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (provider_id, specialty)
);

create table if not exists public.respond_provider_links (
  id uuid primary key default gen_random_uuid(),
  respond_contact_id text not null,
  provider_id uuid not null references public.service_providers(id) on delete cascade,
  link_status text not null default 'confirmed'
    check (link_status in ('candidate','confirmed','revoked')),
  link_source text not null
    check (link_source in ('human_confirmation','exact_phone_unique','manual_admin')),
  confirmed_by uuid null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create unique index if not exists respond_provider_links_confirmed_contact_uidx
  on public.respond_provider_links(respond_contact_id)
  where link_status='confirmed';

create index if not exists service_provider_specialties_specialty_idx
  on public.service_provider_specialties(specialty);

alter table public.service_providers enable row level security;
alter table public.service_provider_specialties enable row level security;
alter table public.respond_provider_links enable row level security;

revoke all on public.service_providers from public,anon,authenticated;
revoke all on public.service_provider_specialties from public,anon,authenticated;
revoke all on public.respond_provider_links from public,anon,authenticated;

grant select,insert,update on public.service_providers to service_role;
grant select,insert,update on public.service_provider_specialties to service_role;
grant select,insert,update on public.respond_provider_links to service_role;

comment on table public.service_providers is
  'Identidad canónica de proveedores y técnicos externos; separada de client_identities.';
comment on table public.respond_provider_links is
  'Vínculo Respond -> proveedor/técnico. No implica identidad de cliente ni acceso a contratos.';
