-- DEV ONLY - Fase 2A.2-0C - esquema minimo del Centro Operativo Administrativo.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- NUNCA ejecutar como migracion productiva.
-- No contiene datos ni replica grants/policies de Produccion.

begin;

create extension if not exists pgcrypto;

create or replace function public.dev_2a2_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Dependencias estructurales minimas. No se cargan usuarios ni inmuebles reales.
create table if not exists public.users (
  id uuid primary key
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid null references public.users(id),
  name text not null,
  status text null default 'disponible',
  created_at timestamptz null default now(),
  constraint properties_status_check
    check (status = any (array['disponible', 'ocupada', 'mantenimiento']))
);

create table if not exists public.condominios (
  id uuid primary key default gen_random_uuid()
);

create table if not exists public.propietarios_inmuebles (
  id uuid primary key default gen_random_uuid()
);

create table if not exists public.plantillas_inspeccion (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo_inmueble text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nombre, tipo_inmueble),
  constraint plantillas_inspeccion_tipo_inmueble_check
    check (tipo_inmueble = any (array[
      'casa', 'departamento', 'local_comercial', 'oficina',
      'bodega', 'terreno', 'otro'
    ]))
);

drop trigger if exists trg_plantillas_inspeccion_updated on public.plantillas_inspeccion;
create trigger trg_plantillas_inspeccion_updated
before update on public.plantillas_inspeccion
for each row execute function public.dev_2a2_set_updated_at();

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid null references public.properties(id),
  tenant_id uuid null references public.users(id),
  start_date date not null,
  end_date date not null,
  monthly_rent numeric(10,2) null,
  deposit_amount numeric(10,2) null,
  payment_day integer null default 5,
  status text null default 'activo',
  created_at timestamptz null default now(),
  notes text null,
  tenant_name text null,
  property_name text null,
  tenant_email text null,
  commission_type text null default 'porcentaje',
  commission_value numeric(10,2) null default 0,
  commission_who text null default 'propietario_descuento',
  owner_name text null,
  rent_receiver text null default 'inmobiliaria',
  tenant_phone text null,
  co_responsable_nombre text null,
  co_responsable_telefono text null,
  commission_status text null default 'pendiente_cobro',
  constraint contracts_commission_type_check
    check (commission_type = any (array['porcentaje', 'fijo'])),
  constraint contracts_commission_who_check
    check (commission_who = any (array['propietario_descuento', 'propietario_aparte', 'inquilino'])),
  constraint contracts_rent_receiver_check
    check (rent_receiver = any (array['inmobiliaria', 'propietario'])),
  constraint contracts_status_check
    check (status = any (array['activo', 'vencido', 'cancelado']))
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid null references public.contracts(id),
  period_month integer null,
  period_year integer null,
  amount numeric(10,2) null,
  due_date date null,
  payment_date date null,
  payment_method text null,
  status text null default 'pendiente',
  receipt_url text null,
  notes text null,
  created_at timestamptz null default now(),
  tenant_name text null,
  property_name text null,
  tenant_email text null,
  recibido_por text null,
  constraint payments_status_check
    check (status = any (array['pendiente', 'en_revision', 'pagado', 'atrasado']))
);

create table if not exists public.maintenance_tickets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid null references public.properties(id),
  reported_by uuid null references public.users(id),
  assigned_to uuid null references public.users(id),
  title text not null,
  description text null,
  category text null,
  priority text null default 'media',
  status text null default 'nuevo',
  cost numeric(10,2) null,
  created_at timestamptz null default now(),
  payer text null,
  provider_cost numeric(10,2) null default 0,
  charged_amount numeric(10,2) null default 0,
  advance_amount numeric(10,2) null default 0,
  advance_paid boolean null default false,
  status_pago text null default 'pendiente',
  property_name text null,
  tenant_name text null,
  updated_at timestamptz null default now(),
  created_by text null,
  condominio_id uuid null references public.condominios(id) on delete set null,
  fotos jsonb null default '[]'::jsonb,
  descontado_de_liquidacion boolean null default false,
  fecha_cobro_propietario date null,
  forma_cobro_propietario text null,
  recibo_cobro_id uuid null,
  constraint maintenance_tickets_payer_check
    check (payer = any (array['propietario', 'inquilino', 'inmobiliaria'])),
  constraint maintenance_tickets_priority_check
    check (priority = any (array['baja', 'media', 'alta', 'urgente'])),
  constraint maintenance_tickets_status_check
    check (status = any (array[
      'nuevo', 'revisado', 'cotizado', 'aprobado', 'en_proceso',
      'terminado', 'cerrado', 'cancelado'
    ])),
  constraint maintenance_tickets_status_pago_check
    check (status_pago = any (array['pendiente', 'anticipo_pagado', 'liquidado']))
);

create index if not exists idx_tickets_condominio_id
  on public.maintenance_tickets (condominio_id);

create table if not exists public.maintenance_quotes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid null references public.maintenance_tickets(id) on delete cascade,
  property_name text null,
  tenant_name text null,
  owner_email text null,
  tenant_email text null,
  payer text null default 'propietario',
  descripcion text null,
  costo_proveedor numeric null default 0,
  margen_pct numeric null default 30,
  monto_final numeric null default 0,
  status text null default 'pendiente',
  motivo_rechazo text null,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  monto_sin_descuento numeric null,
  descuento_tipo text null,
  descuento_valor numeric null default 0
);

-- Las tres tablas legacy deben estar vacias y conservarse para rollback.
do $$
declare
  has_rows boolean;
  is_legacy boolean;
begin
  if to_regclass('public.firmas') is null
     or to_regclass('public.firma_etapas') is null
     or to_regclass('public.firmas_citas') is null then
    raise exception '2A.2 DEV: faltan una o mas tablas legacy de Firmas';
  end if;

  select not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'firmas' and column_name = 'titulo'
  ) into is_legacy;

  if is_legacy then
    if to_regclass('public.firmas_pre_2a2') is not null
       or to_regclass('public.firma_etapas_pre_2a2') is not null
       or to_regclass('public.firmas_citas_pre_2a2') is not null then
      raise exception '2A.2 DEV: ya existe una tabla de respaldo *_pre_2a2';
    end if;

    execute 'select exists (select 1 from public.firmas limit 1)' into has_rows;
    if has_rows then raise exception '2A.2 DEV: public.firmas contiene filas inesperadas'; end if;
    execute 'select exists (select 1 from public.firma_etapas limit 1)' into has_rows;
    if has_rows then raise exception '2A.2 DEV: public.firma_etapas contiene filas inesperadas'; end if;
    execute 'select exists (select 1 from public.firmas_citas limit 1)' into has_rows;
    if has_rows then raise exception '2A.2 DEV: public.firmas_citas contiene filas inesperadas'; end if;

    alter table public.firma_etapas rename to firma_etapas_pre_2a2;
    alter table public.firmas_citas rename to firmas_citas_pre_2a2;
    alter table public.firmas rename to firmas_pre_2a2;

    -- Los indices viven en el schema, no dentro del namespace de la tabla.
    -- Liberar sus nombres productivos evita colisiones al recrear las tablas.
    alter index if exists public.firma_etapas_pkey rename to firma_etapas_pre_2a2_pkey;
    alter index if exists public.firmas_citas_pkey rename to firmas_citas_pre_2a2_pkey;
    alter index if exists public.firmas_pkey rename to firmas_pre_2a2_pkey;
  end if;
end;
$$;

create table if not exists public.firmas (
  id uuid primary key default gen_random_uuid(),
  folio text generated always as ('EXP-' || substr(id::text, 1, 8)) stored,
  tipo text not null,
  es_contado boolean null default false,
  titulo text not null,
  easybroker_id text null,
  direccion text null,
  nombre_comprador text not null,
  nombre_vendedor text not null,
  monto_apartado numeric null,
  forma_pago text null,
  propietario_asiste boolean null,
  modalidad_firma text null,
  fecha_apartado date not null default current_date,
  fecha_firma_programada timestamptz null,
  urgente boolean null default false,
  etapa_actual integer null default 1,
  status text null default 'activo',
  creado_por uuid null references auth.users(id),
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  monto_cierre numeric(12,2) null,
  propiedad_id uuid null references public.propiedades(id) on delete set null,
  recibo_id uuid null references public.recibos_apartado(id) on delete set null,
  constraint firmas_forma_pago_check
    check (forma_pago = any (array['efectivo', 'transferencia'])),
  constraint firmas_modalidad_firma_check
    check (modalidad_firma = any (array['presencial', 'digital'])),
  constraint firmas_status_check
    check (status = any (array['activo', 'cancelado', 'completado'])),
  constraint firmas_tipo_check
    check (tipo = any (array['arrendamiento', 'compraventa']))
);

create index if not exists firmas_propiedad_id_idx on public.firmas (propiedad_id);
create index if not exists firmas_status_idx on public.firmas (status);
create unique index if not exists firmas_recibo_id_unique
  on public.firmas (recibo_id) where recibo_id is not null;

drop trigger if exists firmas_updated_at on public.firmas;
create trigger firmas_updated_at
before update on public.firmas
for each row execute function public.dev_2a2_set_updated_at();

create table if not exists public.firma_etapas (
  id uuid primary key default gen_random_uuid(),
  firma_id uuid null references public.firmas(id) on delete cascade,
  orden integer not null,
  clave text not null,
  nombre text not null,
  responsable text not null,
  status text null default 'pendiente',
  notas text null,
  completada_por uuid null references auth.users(id),
  completada_at timestamptz null,
  alerta_enviada boolean null default false,
  created_at timestamptz null default now(),
  constraint firma_etapas_status_check
    check (status = any (array['pendiente', 'en_proceso', 'completada', 'no_aplica', 'bloqueada']))
);

create index if not exists firma_etapas_firma_id_idx on public.firma_etapas (firma_id);

create table if not exists public.firmas_citas (
  id uuid primary key default gen_random_uuid(),
  firma_id uuid null references public.firmas(id) on delete cascade,
  titulo text not null,
  tipo text not null,
  fecha date not null,
  hora time not null,
  duracion_min integer null default 60,
  lugar text null,
  asistentes text[] null,
  notas text null,
  creado_por text null,
  created_at timestamptz null default now(),
  constraint firmas_citas_tipo_check
    check (tipo = any (array[
      'firma_arrendamiento', 'firma_compraventa', 'avaluo',
      'entrega_llaves', 'otro'
    ]))
);

create table if not exists public.solicitudes_inquilino (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  nombre_completo text null,
  razon_social text null,
  inmueble_interes text null,
  status text null default 'pendiente',
  cobro_investigacion boolean null default false,
  monto_investigacion numeric null default 1000,
  fecha_cobro_investigacion date null,
  ia_revision_manual boolean null default false,
  ia_analisis_documental jsonb null
);

drop trigger if exists trg_solicitudes_updated_at on public.solicitudes_inquilino;
create trigger trg_solicitudes_updated_at
before update on public.solicitudes_inquilino
for each row execute function public.dev_2a2_set_updated_at();

create table if not exists public.poliza_expedientes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  propietario_id uuid null references public.propietarios_inmuebles(id),
  inquilino_id uuid null references public.solicitudes_inquilino(id),
  fecha_firma date null,
  fecha_inicio date null,
  nombre_arrendatario text null,
  direccion_inmueble text null,
  status text null default 'borrador',
  status_expediente text null default 'pendiente_firma',
  monto_poliza numeric(10,2) null,
  anticipo_poliza numeric null default 0,
  anticipo_pagado boolean null default false,
  saldo_pagado boolean null default false,
  fecha_vigencia date null,
  expediente_anterior_id uuid null references public.poliza_expedientes(id)
);

create index if not exists idx_expedientes_inquilino on public.poliza_expedientes (inquilino_id);
create index if not exists idx_expedientes_propietario on public.poliza_expedientes (propietario_id);
create index if not exists idx_expedientes_status on public.poliza_expedientes (status);

drop trigger if exists trg_expedientes_updated_at on public.poliza_expedientes;
create trigger trg_expedientes_updated_at
before update on public.poliza_expedientes
for each row execute function public.dev_2a2_set_updated_at();

create table if not exists public.inspecciones (
  id uuid primary key default gen_random_uuid(),
  inmueble_id uuid null references public.properties(id) on delete set null,
  contrato_id uuid null references public.contracts(id) on delete set null,
  plantilla_id uuid null references public.plantillas_inspeccion(id) on delete set null,
  tipo_inmueble text not null default 'otro',
  tipo_inspeccion text not null default 'entrega_recepcion',
  fecha date not null default current_date,
  hora time not null default current_time,
  recibido_por text null,
  entregado_por text null,
  estatus text not null default 'borrador',
  observaciones_generales text null,
  firma_inquilino_url text null,
  firma_representante_url text null,
  pdf_url text null,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  cerrada_por uuid null references auth.users(id) on delete set null,
  cerrada_en timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspecciones_estatus_check
    check (estatus = any (array[
      'borrador', 'en_revision', 'con_observaciones',
      'pendiente_presupuesto', 'pendiente_autorizacion_propietario', 'cerrada'
    ])),
  constraint inspecciones_tipo_inmueble_check
    check (tipo_inmueble = any (array[
      'casa', 'departamento', 'local_comercial', 'oficina',
      'bodega', 'terreno', 'otro'
    ])),
  constraint inspecciones_tipo_inspeccion_check
    check (tipo_inspeccion = 'entrega_recepcion')
);

create index if not exists idx_inspecciones_contrato on public.inspecciones (contrato_id);
create index if not exists idx_inspecciones_estatus on public.inspecciones (estatus);
create index if not exists idx_inspecciones_fecha on public.inspecciones (fecha desc);
create index if not exists idx_inspecciones_inmueble on public.inspecciones (inmueble_id);

drop trigger if exists trg_inspecciones_updated on public.inspecciones;
create trigger trg_inspecciones_updated
before update on public.inspecciones
for each row execute function public.dev_2a2_set_updated_at();

commit;
