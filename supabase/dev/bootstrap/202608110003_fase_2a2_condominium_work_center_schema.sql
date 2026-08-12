-- DEV ONLY - Fase 2A.2-A - complemento read-only de Condominios.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- NUNCA ejecutar como migracion productiva.
-- Contiene solo el esquema minimo requerido por el Centro Operativo.

begin;

alter table public.condominios
  add column if not exists activo boolean not null default true;

create table if not exists public.unidades_condominio (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_dev_2a2_unidades_condominio_id
  on public.unidades_condominio (condominio_id);

create table if not exists public.cuotas_condominio (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  unidad_id uuid not null references public.unidades_condominio(id) on delete cascade,
  periodo text not null,
  monto numeric not null,
  status text not null default 'pendiente',
  fecha_vencimiento date null,
  comprobante_url text null,
  created_at timestamptz not null default now(),
  constraint dev_2a2_cuotas_status_check
    check (status = any (array['pendiente', 'pagado', 'atrasado'])),
  constraint dev_2a2_cuotas_unidad_periodo_key unique (unidad_id, periodo)
);

create index if not exists idx_dev_2a2_cuotas_condominio_id
  on public.cuotas_condominio (condominio_id);
create index if not exists idx_dev_2a2_cuotas_unidad_id
  on public.cuotas_condominio (unidad_id);
create index if not exists idx_dev_2a2_cuotas_status_due
  on public.cuotas_condominio (status, fecha_vencimiento);
create index if not exists idx_dev_2a2_cuotas_periodo
  on public.cuotas_condominio (periodo);

commit;
