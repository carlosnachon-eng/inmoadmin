-- Emporio Blindaje Legal Partner - MVP
-- Ejecutar en Supabase SQL Editor despues de revisar en staging.

create extension if not exists pgcrypto;

create table if not exists public.partner_agencies (
  id uuid primary key default gen_random_uuid(),
  nombre_comercial text not null,
  razon_social text,
  rfc text,
  email_contacto text,
  telefono text,
  commission_rate numeric(6,4) not null default 0.20,
  status text not null default 'activo' check (status in ('pendiente', 'activo', 'suspendido')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  partner_agency_id uuid not null references public.partner_agencies(id) on delete cascade,
  nombre text,
  email text,
  role text not null default 'owner' check (role in ('owner', 'agent', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(auth_user_id)
);

create table if not exists public.partner_operations (
  id uuid primary key default gen_random_uuid(),
  folio text unique default ('P-' || upper(substr(gen_random_uuid()::text, 1, 8))),
  partner_agency_id uuid not null references public.partner_agencies(id) on delete cascade,
  created_by uuid references auth.users(id),
  solicitud_inquilino_id uuid references public.solicitudes_inquilino(id),
  propietario_id uuid references public.propietarios_inmuebles(id),
  poliza_expediente_id uuid references public.poliza_expedientes(id),
  status_partner text not null default 'recibida' check (status_partner in (
    'recibida',
    'en_revision',
    'faltan_documentos',
    'aprobada',
    'contrato_en_proceso',
    'lista_para_firma',
    'activa',
    'rechazada',
    'cancelada'
  )),
  nombre_propietario text,
  nombre_inquilino text,
  direccion_inmueble text,
  monto_renta numeric,
  monto_poliza_estimado numeric,
  monto_poliza_final numeric,
  commission_rate numeric(6,4) not null default 0.20,
  commission_estimated numeric,
  commission_generated numeric not null default 0,
  commission_paid numeric not null default 0,
  commission_generated_at timestamptz,
  commission_paid_at timestamptz,
  observaciones_publicas text,
  observaciones_internas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_documents (
  id uuid primary key default gen_random_uuid(),
  partner_operation_id uuid not null references public.partner_operations(id) on delete cascade,
  partner_agency_id uuid not null references public.partner_agencies(id) on delete cascade,
  party text not null default 'inmueble' check (party in ('propietario', 'inquilino', 'inmueble', 'final')),
  document_type text not null,
  storage_path text not null,
  original_name text,
  status text not null default 'recibido' check (status in ('pendiente', 'recibido', 'rechazado', 'aprobado')),
  visible_to_partner boolean not null default false,
  is_final boolean not null default false,
  observacion text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_partner_users_auth_user_id on public.partner_users(auth_user_id);
create index if not exists idx_partner_operations_agency on public.partner_operations(partner_agency_id, created_at desc);
create index if not exists idx_partner_operations_solicitud on public.partner_operations(solicitud_inquilino_id);
create index if not exists idx_partner_operations_expediente on public.partner_operations(poliza_expediente_id);
create index if not exists idx_partner_documents_operation on public.partner_documents(partner_operation_id);

alter table public.partner_agencies enable row level security;
alter table public.partner_users enable row level security;
alter table public.partner_operations enable row level security;
alter table public.partner_documents enable row level security;

create or replace function public.partner_agency_for_auth()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select partner_agency_id
  from public.partner_users
  where auth_user_id = auth.uid()
    and active = true
  limit 1
$$;

drop policy if exists partner_read_own_agency on public.partner_agencies;
create policy partner_read_own_agency
on public.partner_agencies
for select
to authenticated
using (id = public.partner_agency_for_auth());

drop policy if exists partner_read_self_user on public.partner_users;
create policy partner_read_self_user
on public.partner_users
for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists partner_read_own_operations on public.partner_operations;
create policy partner_read_own_operations
on public.partner_operations
for select
to authenticated
using (partner_agency_id = public.partner_agency_for_auth());

drop policy if exists partner_insert_own_operations on public.partner_operations;
create policy partner_insert_own_operations
on public.partner_operations
for insert
to authenticated
with check (partner_agency_id = public.partner_agency_for_auth());

drop policy if exists partner_read_own_documents on public.partner_documents;
create policy partner_read_own_documents
on public.partner_documents
for select
to authenticated
using (partner_agency_id = public.partner_agency_for_auth());

drop policy if exists partner_insert_own_documents on public.partner_documents;
create policy partner_insert_own_documents
on public.partner_documents
for insert
to authenticated
with check (partner_agency_id = public.partner_agency_for_auth());

-- Para el MVP, el equipo interno seguira operando desde el service role/API o
-- desde las politicas internas existentes. Antes de exponer mas operaciones al
-- cliente, cerrar RLS de solicitudes_inquilino, propietarios_inmuebles y storage.
