-- DEV ONLY - Bootstrap de fuentes operativas requeridas por Fase 1.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- NUNCA ejecutar en Produccion (bnzrnizrmonjxlktbhlp).
-- Derivado de metadata productiva READ-ONLY el 2026-08-18. No contiene datos.

begin;

create extension if not exists pgcrypto;

do $$
declare
  table_name text;
  target_tables constant text[] := array[
    'servicios_inmueble', 'pagos_servicios', 'owner_payments',
    'owner_payment_receipts', 'property_expenses', 'comisiones_admin', 'llaves'
  ];
begin
  if to_regclass('public.contracts') is null
     or to_regclass('public.properties') is null
     or to_regprocedure('public.current_profile_can_view_operations_work_center()') is null then
    raise exception 'Fase 1 DEV: faltan contracts, properties o la guarda RLS del Work Center';
  end if;

  -- IF NOT EXISTS sólo se acepta para una repetición de este mismo bootstrap.
  -- Una tabla homónima sin el marcador exacto se considera ajena/incompatible.
  foreach table_name in array target_tables loop
    if to_regclass(format('public.%I', table_name)) is not null
       and coalesce(obj_description(to_regclass(format('public.%I', table_name)), 'pg_class'), '')
         <> 'dev-bootstrap:202608180002:fase-1-operational-sources' then
      raise exception 'Fase 1 DEV: public.% ya existe y no pertenece a este bootstrap', table_name;
    end if;
  end loop;
end;
$$;

create table if not exists public.servicios_inmueble (
  id uuid primary key default gen_random_uuid(),
  property_name text not null,
  contract_id uuid null references public.contracts(id),
  tipo text not null,
  periodicidad text not null default 'mensual',
  dia_corte integer null,
  aplica boolean null default true,
  created_at timestamptz null default now(),
  dia_limite_pago integer null,
  notas text null,
  numero_cuenta text null,
  quien_paga text null default 'inquilino'
);

create table if not exists public.property_expenses (
  id uuid primary key default gen_random_uuid(),
  property_name text not null,
  category text null default 'otro',
  description text not null,
  amount numeric(10,2) not null,
  paid_by text null default 'propietario',
  payment_method text null default 'transferencia',
  date date null default current_date,
  notes text null,
  created_by text null,
  created_at timestamptz null default now(),
  constraint property_expenses_category_check check (
    category = any (array['condominio','predial','agua','luz','gas','seguro','mantenimiento_comun','otro'])
  ),
  constraint property_expenses_paid_by_check check (
    paid_by = any (array['propietario','inmobiliaria'])
  ),
  constraint property_expenses_payment_method_check check (
    payment_method = any (array['efectivo','transferencia'])
  )
);

create table if not exists public.pagos_servicios (
  id uuid primary key default gen_random_uuid(),
  servicio_id uuid null references public.servicios_inmueble(id),
  property_name text not null,
  contract_id uuid null,
  tipo text not null,
  periodo text not null,
  fecha_limite date null,
  status text null default 'pendiente',
  comprobante_url text null,
  monto numeric null,
  notas text null,
  subido_por text null,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  gasto_id uuid null references public.property_expenses(id) on delete set null
);

create table if not exists public.owner_payments (
  id uuid primary key default gen_random_uuid(),
  owner_name text not null,
  owner_email text null,
  period_description text null,
  properties text[] null,
  total_rent numeric(10,2) null default 0,
  total_commission numeric(10,2) null default 0,
  total_liquid numeric(10,2) null default 0,
  amount_paid numeric(10,2) null default 0,
  payment_method text null,
  payment_date date null,
  status text null default 'pendiente',
  notes text null,
  created_at timestamptz null default now(),
  rent_receiver text null default 'emporio',
  constraint owner_payments_payment_method_check check (
    payment_method = any (array['transferencia','efectivo'])
  ),
  constraint owner_payments_status_check check (
    status = any (array['pendiente','pagado_parcial','pagado'])
  )
);

create table if not exists public.owner_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  owner_name text not null,
  owner_email text not null,
  property_name text null,
  concepto text not null,
  monto numeric not null,
  forma_pago text not null,
  comprobante_url text null,
  firma_url text null,
  periodo text null,
  fecha date not null,
  created_by text null,
  created_at timestamptz null default now(),
  constraint owner_payment_receipts_concepto_check check (
    concepto = any (array['adelanto','parcial','total','mantenimiento'])
  ),
  constraint owner_payment_receipts_forma_pago_check check (
    forma_pago = any (array['efectivo','transferencia'])
  )
);

create table if not exists public.comisiones_admin (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid null references public.contracts(id) on delete cascade,
  periodo text not null,
  monto numeric not null,
  tipo text not null,
  status text not null default 'pendiente',
  fecha_cobro date null,
  forma_pago text null,
  notas text null,
  created_by text null,
  created_at timestamptz null default now(),
  constraint comisiones_admin_contract_id_periodo_key unique (contract_id, periodo),
  constraint comisiones_admin_status_check check (
    status = any (array['pendiente','cobrada'])
  ),
  constraint comisiones_admin_tipo_check check (
    tipo = any (array['automatica','manual'])
  )
);

create table if not exists public.llaves (
  id uuid primary key default gen_random_uuid(),
  numero integer not null,
  propiedad text not null,
  en_resguardo boolean null default true,
  portador_email text null,
  portador_nombre text null,
  fecha_prestamo timestamptz null,
  notas text null,
  activa boolean null default true,
  created_at timestamptz null default now(),
  foto_url text null
);

create unique index if not exists llaves_numero_activa_unique
  on public.llaves (numero) where activa = true;

comment on table public.servicios_inmueble is 'dev-bootstrap:202608180002:fase-1-operational-sources';
comment on table public.pagos_servicios is 'dev-bootstrap:202608180002:fase-1-operational-sources';
comment on table public.owner_payments is 'dev-bootstrap:202608180002:fase-1-operational-sources';
comment on table public.owner_payment_receipts is 'dev-bootstrap:202608180002:fase-1-operational-sources';
comment on table public.property_expenses is 'dev-bootstrap:202608180002:fase-1-operational-sources';
comment on table public.comisiones_admin is 'dev-bootstrap:202608180002:fase-1-operational-sources';
comment on table public.llaves is 'dev-bootstrap:202608180002:fase-1-operational-sources';

do $$
declare
  table_name text;
  policy_name text;
  target_tables constant text[] := array[
    'servicios_inmueble', 'pagos_servicios', 'owner_payments',
    'owner_payment_receipts', 'property_expenses', 'comisiones_admin', 'llaves'
  ];
begin
  foreach table_name in array target_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format('grant all privileges on table public.%I to service_role', table_name);

    for policy_name in
      select pol.polname
      from pg_policy pol
      join pg_class rel on rel.oid = pol.polrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public' and rel.relname = table_name
    loop
      execute format('drop policy %I on public.%I', policy_name, table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.current_profile_can_view_operations_work_center())',
      table_name || '_operations_select', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.current_profile_can_view_operations_work_center())',
      table_name || '_operations_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.current_profile_can_view_operations_work_center()) with check (public.current_profile_can_view_operations_work_center())',
      table_name || '_operations_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.current_profile_can_view_operations_work_center())',
      table_name || '_operations_delete', table_name
    );
  end loop;
end;
$$;

commit;
