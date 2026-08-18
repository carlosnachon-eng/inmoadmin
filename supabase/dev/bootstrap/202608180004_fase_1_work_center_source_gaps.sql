-- DEV ONLY - Cierra los gaps de metadata detectados por el Work Center Fase 1.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- NUNCA ejecutar en Produccion (bnzrnizrmonjxlktbhlp).
-- Derivado exclusivamente de metadata productiva READ-ONLY el 2026-08-18.

begin;

do $$
declare
  owner_email_type regtype;
  owner_email_not_null boolean;
  owner_email_default text;
begin
  if to_regclass('public.properties') is null
     or to_regprocedure('public.current_profile_can_view_operations_work_center()') is null then
    raise exception 'Fase 1 DEV: faltan properties o la guarda RLS del Work Center';
  end if;

  select a.atttypid::regtype, a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
    into owner_email_type, owner_email_not_null, owner_email_default
  from pg_attribute a
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = 'public.properties'::regclass
    and a.attname = 'owner_email'
    and a.attnum > 0
    and not a.attisdropped;

  if found then
    if owner_email_type <> 'text'::regtype
       or owner_email_not_null
       or owner_email_default is not null then
      raise exception 'Fase 1 DEV: properties.owner_email existe con metadata incompatible';
    end if;
  else
    alter table public.properties add column owner_email text null;
    comment on column public.properties.owner_email is
      'dev-bootstrap:202608180004:fase-1-work-center-source-gaps';
  end if;

  if to_regclass('public.cash_movements') is not null
     and coalesce(obj_description(to_regclass('public.cash_movements'), 'pg_class'), '')
       <> 'dev-bootstrap:202608180004:fase-1-work-center-source-gaps' then
    raise exception 'Fase 1 DEV: cash_movements ya existe y no pertenece a este bootstrap';
  end if;
end;
$$;

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  category text not null,
  description text not null,
  amount numeric not null,
  payment_method text null default 'transferencia',
  reference_id uuid null,
  reference_type text null,
  date date null default current_date,
  notes text null,
  created_by text null,
  created_at timestamptz null default now(),
  constraint cash_movements_type_check check (
    type = any (array['entrada'::text, 'salida'::text])
  ),
  constraint cash_movements_payment_method_check check (
    payment_method = any (array['efectivo'::text, 'transferencia'::text])
  )
);

do $$
begin
  if (select count(*) from information_schema.columns
      where table_schema='public' and table_name='cash_movements') <> 12
     or exists (
       select 1 from (values
         ('id','uuid','NO','gen_random_uuid()'),
         ('type','text','NO',null),
         ('category','text','NO',null),
         ('description','text','NO',null),
         ('amount','numeric','NO',null),
         ('payment_method','text','YES','''transferencia''::text'),
         ('reference_id','uuid','YES',null),
         ('reference_type','text','YES',null),
         ('date','date','YES','CURRENT_DATE'),
         ('notes','text','YES',null),
         ('created_by','text','YES',null),
         ('created_at','timestamp with time zone','YES','now()')
       ) expected(column_name,data_type,is_nullable,column_default)
       left join information_schema.columns actual
         on actual.table_schema='public' and actual.table_name='cash_movements'
        and actual.column_name=expected.column_name
       where actual.column_name is null
          or actual.data_type <> expected.data_type
          or actual.is_nullable <> expected.is_nullable
          or actual.column_default is distinct from expected.column_default
     ) then
    raise exception 'Fase 1 DEV: cash_movements existe con columnas incompatibles';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.cash_movements'::regclass
      and conname='cash_movements_pkey' and contype='p'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid='public.cash_movements'::regclass
      and conname='cash_movements_type_check' and contype='c'
      and pg_get_constraintdef(oid) like '%entrada%salida%'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid='public.cash_movements'::regclass
      and conname='cash_movements_payment_method_check' and contype='c'
      and pg_get_constraintdef(oid) like '%efectivo%transferencia%'
  ) then
    raise exception 'Fase 1 DEV: cash_movements existe con constraints incompatibles';
  end if;
end;
$$;

comment on table public.cash_movements is
  'dev-bootstrap:202608180004:fase-1-work-center-source-gaps';

alter table public.cash_movements enable row level security;

revoke all on table public.cash_movements from public, anon, authenticated;
grant select on table public.cash_movements to authenticated;
grant all privileges on table public.cash_movements to service_role;

drop policy if exists cash_movements_operations_select on public.cash_movements;
create policy cash_movements_operations_select
  on public.cash_movements
  for select
  to authenticated
  using (public.current_profile_can_view_operations_work_center());

commit;
