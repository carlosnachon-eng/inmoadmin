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
  ciudad text,
  website text,
  logo_url text,
  brand_color text not null default '#b91c3c',
  commission_rate numeric(6,4) not null default 0.20,
  status text not null default 'activo' check (status in ('pendiente', 'activo', 'suspendido')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
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
  propietario_link_enviado boolean not null default false,
  inquilino_link_enviado boolean not null default false,
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
  telefono_propietario text,
  correo_propietario text,
  nombre_inquilino text,
  telefono_inquilino text,
  correo_inquilino text,
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

alter table public.partner_agencies add column if not exists ciudad text;
alter table public.partner_agencies add column if not exists website text;
alter table public.partner_agencies add column if not exists logo_url text;
alter table public.partner_agencies add column if not exists brand_color text not null default '#b91c3c';
alter table public.partner_agencies add column if not exists approved_at timestamptz;
alter table public.partner_agencies add column if not exists approved_by uuid references auth.users(id);

alter table public.partner_operations add column if not exists propietario_link_enviado boolean not null default false;
alter table public.partner_operations add column if not exists inquilino_link_enviado boolean not null default false;
alter table public.partner_operations add column if not exists telefono_propietario text;
alter table public.partner_operations add column if not exists correo_propietario text;
alter table public.partner_operations add column if not exists telefono_inquilino text;
alter table public.partner_operations add column if not exists correo_inquilino text;

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

create or replace function public.has_module_permission(module_name text, needs_edit boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.active, true) = true
      and (
        p.role_id = 'admin'
        or exists (
          select 1
          from public.permisos_modulo pm
          where pm.role_id = p.role_id
            and pm.modulo = module_name
            and pm.puede_ver = true
            and (needs_edit = false or pm.puede_editar = true)
        )
      )
  )
$$;

drop policy if exists partner_read_own_agency on public.partner_agencies;
create policy partner_read_own_agency
on public.partner_agencies
for select
to authenticated
using (id = public.partner_agency_for_auth() or public.has_module_permission('poliza', false));

drop policy if exists internal_update_partner_agencies on public.partner_agencies;
create policy internal_update_partner_agencies
on public.partner_agencies
for update
to authenticated
using (public.has_module_permission('poliza', true))
with check (public.has_module_permission('poliza', true));

drop policy if exists partner_read_self_user on public.partner_users;
create policy partner_read_self_user
on public.partner_users
for select
to authenticated
using (auth_user_id = auth.uid() or public.has_module_permission('poliza', false));

drop policy if exists partner_read_own_operations on public.partner_operations;
create policy partner_read_own_operations
on public.partner_operations
for select
to authenticated
using (partner_agency_id = public.partner_agency_for_auth() or public.has_module_permission('poliza', false));

drop policy if exists partner_insert_own_operations on public.partner_operations;
create policy partner_insert_own_operations
on public.partner_operations
for insert
to authenticated
with check (partner_agency_id = public.partner_agency_for_auth() or public.has_module_permission('poliza', true));

drop policy if exists internal_update_partner_operations on public.partner_operations;
create policy internal_update_partner_operations
on public.partner_operations
for update
to authenticated
using (public.has_module_permission('poliza', true))
with check (public.has_module_permission('poliza', true));

drop policy if exists partner_read_own_documents on public.partner_documents;
create policy partner_read_own_documents
on public.partner_documents
for select
to authenticated
using (partner_agency_id = public.partner_agency_for_auth() or public.has_module_permission('poliza', false));

drop policy if exists partner_insert_own_documents on public.partner_documents;
create policy partner_insert_own_documents
on public.partner_documents
for insert
to authenticated
with check (partner_agency_id = public.partner_agency_for_auth() or public.has_module_permission('poliza', true));

drop policy if exists internal_update_partner_documents on public.partner_documents;
create policy internal_update_partner_documents
on public.partner_documents
for update
to authenticated
using (public.has_module_permission('poliza', true))
with check (public.has_module_permission('poliza', true));

-- Para el MVP, el equipo interno seguira operando desde el service role/API o
-- desde las politicas internas existentes. Antes de exponer mas operaciones al
-- cliente, cerrar RLS de solicitudes_inquilino, propietarios_inmuebles y storage.
