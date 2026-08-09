-- DEV ONLY - Esquema base minimo para probar Fase 2A en Supabase DEV/PREVIEW
-- Estado: NO EJECUTADO.
--
-- Este archivo existe porque el proyecto `inmoadmin-dev` fue creado vacio.
-- No busca reemplazar una replica completa de Produccion. Solo crea el
-- subconjunto minimo de tablas/columnas que necesitan la migracion Fase 2A y
-- el seed sintetico.
--
-- NO ejecutar en Produccion.
-- Proyecto productivo conocido: https://bnzrnizrmonjxlktbhlp...supabase.co

begin;

create extension if not exists pgcrypto;

create table if not exists public.roles (
  id text primary key,
  nombre text not null,
  descripcion text null,
  es_externo boolean not null default false
);

create table if not exists public.profiles (
  id uuid primary key,
  email text unique,
  full_name text null,
  role text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  role_id text null references public.roles(id),
  telefono text null
);

create table if not exists public.permisos_modulo (
  id uuid primary key default gen_random_uuid(),
  role_id text not null references public.roles(id),
  modulo text not null,
  puede_ver boolean not null default false,
  puede_editar boolean not null default false,
  alcance text null,
  unique (role_id, modulo)
);

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono text null,
  correo text null,
  etapa_interes text null,
  notas text null,
  asesor_id uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.propiedades (
  id uuid primary key default gen_random_uuid(),
  public_id text unique,
  titulo text not null,
  descripcion text null,
  operacion text null,
  precio numeric(14,2) null,
  moneda text null default 'MXN',
  unidad_precio text null,
  tipo text null,
  recamaras integer null,
  banos numeric(4,1) null,
  estacionamientos integer null,
  m2_construccion numeric(12,2) null,
  m2_terreno numeric(12,2) null,
  direccion text null,
  colonia text null,
  ciudad text null,
  estado text null,
  lat numeric null,
  lng numeric null,
  mostrar_ubicacion_exacta boolean null default false,
  fotos jsonb null default '[]'::jsonb,
  amenidades jsonb null default '[]'::jsonb,
  status text null,
  agente_id uuid null references public.profiles(id),
  notas_internas text null,
  origen text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.citas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid null references public.clientes(id),
  propiedad_id uuid null references public.propiedades(id),
  asesor_id uuid null references public.profiles(id),
  fecha_hora timestamptz not null,
  estado text null,
  notas text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.seguimientos_cliente (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid null references public.clientes(id),
  asesor_id uuid null references public.profiles(id),
  nota text not null,
  tipo text null,
  created_at timestamptz not null default now()
);

create table if not exists public.cierres (
  id uuid primary key default gen_random_uuid(),
  anio integer null,
  mes integer null,
  mes_nombre text null,
  propiedad text null,
  fecha_cierre date null,
  operacion text null,
  precio numeric(14,2) null,
  comision numeric(14,2) null,
  cobrado numeric(14,2) null,
  pendiente numeric(14,2) null,
  vendedor text null,
  com_vendedor numeric(14,2) null,
  pag_vendedor numeric(14,2) null,
  pend_vend numeric(14,2) null,
  comision_inmobiliaria numeric(14,2) null,
  notas text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cobrado_bool boolean null,
  vendedor_pagado boolean null,
  gerente_pagado boolean null,
  monto_gerente numeric(14,2) null,
  gerente_pagado_monto numeric(14,2) null,
  fecha_cobro_asesor date null,
  fecha_cobro_gerente date null,
  propiedad_id uuid null references public.propiedades(id),
  recibo_id uuid null,
  firma_id uuid null,
  prospecto_nombre text null,
  origen text null,
  confirmado_por uuid null references auth.users(id),
  confirmado_en timestamptz null
);

create table if not exists public.cierre_pagos (
  id uuid primary key default gen_random_uuid(),
  cierre_id uuid null references public.cierres(id),
  concepto text null,
  monto numeric(14,2) not null default 0,
  fecha date null,
  metodo_pago text null,
  notas text null,
  created_at timestamptz not null default now()
);

create table if not exists public.recibos_apartado (
  id uuid primary key default gen_random_uuid(),
  folio text null,
  tipo text null,
  cliente_nombre text null,
  cliente_tel text null,
  cliente_email text null,
  inmueble text null,
  monto numeric(14,2) null,
  fecha date null,
  estatus text null,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  propiedad_id uuid null references public.propiedades(id),
  asesor_id uuid null references public.profiles(id)
);

create table if not exists public.recibos_abonos (
  id uuid primary key default gen_random_uuid(),
  recibo_id uuid null references public.recibos_apartado(id),
  monto numeric(14,2) not null default 0,
  fecha date null,
  metodo_pago text null,
  created_at timestamptz not null default now()
);

create table if not exists public.firmas (
  id uuid primary key default gen_random_uuid(),
  recibo_id uuid null references public.recibos_apartado(id),
  propiedad_id uuid null references public.propiedades(id),
  created_at timestamptz not null default now()
);

create table if not exists public.firma_etapas (
  id uuid primary key default gen_random_uuid(),
  firma_id uuid null references public.firmas(id),
  etapa text null,
  status text null,
  created_at timestamptz not null default now()
);

create table if not exists public.firmas_citas (
  id uuid primary key default gen_random_uuid(),
  firma_id uuid null references public.firmas(id),
  fecha_hora timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.firmas_usuarios (
  id uuid primary key default gen_random_uuid(),
  firma_id uuid null references public.firmas(id),
  profile_id uuid null references public.profiles(id),
  rol text null,
  created_at timestamptz not null default now()
);

create table if not exists public.cartas_oferta (
  id uuid primary key default gen_random_uuid(),
  folio text null,
  cliente_nombre text null,
  cliente_tel text null,
  inmueble text null,
  fecha date null,
  estatus text null,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.leads_respond (
  id uuid primary key default gen_random_uuid(),
  contact_id text null,
  conversation_id text null,
  nombre text null,
  telefono text null,
  email text null,
  canal text null,
  asesor_email text null,
  payload jsonb null,
  created_at timestamptz not null default now()
);

create table if not exists public.envios (
  id uuid primary key default gen_random_uuid(),
  asesor_id uuid null references public.profiles(id),
  medio text null,
  destinatario_nombre text null,
  created_at timestamptz not null default now()
);

create table if not exists public.envios_propiedades (
  id uuid primary key default gen_random_uuid(),
  envio_id uuid null references public.envios(id),
  propiedad_id uuid null references public.propiedades(id),
  created_at timestamptz not null default now()
);

-- RLS base permisivo para DEV solo. Las tablas nuevas de Fase 2A traen sus
-- propias policies restrictivas. Este bootstrap no debe usarse en Produccion.
alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.permisos_modulo enable row level security;
alter table public.clientes enable row level security;
alter table public.propiedades enable row level security;
alter table public.citas enable row level security;
alter table public.seguimientos_cliente enable row level security;
alter table public.cierres enable row level security;

drop policy if exists "dev_read_authenticated_roles" on public.roles;
create policy "dev_read_authenticated_roles"
on public.roles for select to authenticated using (true);

drop policy if exists "dev_read_authenticated_profiles" on public.profiles;
create policy "dev_read_authenticated_profiles"
on public.profiles for select to authenticated using (true);

drop policy if exists "dev_read_authenticated_permisos" on public.permisos_modulo;
create policy "dev_read_authenticated_permisos"
on public.permisos_modulo for select to authenticated using (true);

commit;
