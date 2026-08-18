-- READ-ONLY assertions para el bootstrap DEV 202608180004.
-- Ejecutar sólo después del bootstrap en hjfwjnejbcpmknvfpdcq.

do $$
declare
  marker constant text := 'dev-bootstrap:202608180004:fase-1-work-center-source-gaps';
  open_policy_count integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties'
      and column_name = 'owner_email' and data_type = 'text'
      and is_nullable = 'YES' and column_default is null
  ) then
    raise exception 'Check DEV: properties.owner_email ausente o incompatible';
  end if;

  if to_regclass('public.cash_movements') is null then
    raise exception 'Check DEV: cash_movements ausente';
  end if;
  if obj_description('public.cash_movements'::regclass, 'pg_class') <> marker then
    raise exception 'Check DEV: marcador de cash_movements inválido';
  end if;

  if exists (
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
    raise exception 'Check DEV: columnas críticas de cash_movements incompatibles';
  end if;

  if (select count(*) from information_schema.columns
      where table_schema='public' and table_name='cash_movements') <> 12 then
    raise exception 'Check DEV: cash_movements tiene columnas inesperadas';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='cash_movements' and c.relrowsecurity
  ) then
    raise exception 'Check DEV: RLS no está habilitado';
  end if;

  if has_table_privilege('anon','public.cash_movements','SELECT')
     or has_table_privilege('anon','public.cash_movements','INSERT')
     or has_table_privilege('anon','public.cash_movements','UPDATE')
     or has_table_privilege('anon','public.cash_movements','DELETE') then
    raise exception 'Check DEV: anon conserva privilegios indebidos';
  end if;

  if has_table_privilege('authenticated','public.cash_movements','INSERT')
     or has_table_privilege('authenticated','public.cash_movements','UPDATE')
     or has_table_privilege('authenticated','public.cash_movements','DELETE') then
    raise exception 'Check DEV: authenticated conserva escritura directa';
  end if;

  if not has_table_privilege('authenticated','public.cash_movements','SELECT') then
    raise exception 'Check DEV: falta lectura autenticada protegida';
  end if;

  select count(*) into open_policy_count
  from pg_policies
  where schemaname='public' and tablename='cash_movements'
    and (coalesce(qual,'') ~* '^\\s*true\\s*$'
      or coalesce(with_check,'') ~* '^\\s*true\\s*$');
  if open_policy_count <> 0 then
    raise exception 'Check DEV: existe una policy abierta';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='cash_movements'
      and policyname='cash_movements_operations_select'
      and cmd='SELECT' and roles=array['authenticated']::name[]
      and qual='current_profile_can_view_operations_work_center()'
      and with_check is null
  ) then
    raise exception 'Check DEV: policy operativa esperada ausente o distinta';
  end if;

  if not exists (
    select 1 from pg_constraint con
    where con.conrelid='public.cash_movements'::regclass
      and con.conname='cash_movements_type_check'
      and pg_get_constraintdef(con.oid) like '%entrada%salida%'
  ) or not exists (
    select 1 from pg_constraint con
    where con.conrelid='public.cash_movements'::regclass
      and con.conname='cash_movements_payment_method_check'
      and pg_get_constraintdef(con.oid) like '%efectivo%transferencia%'
  ) then
    raise exception 'Check DEV: checks estructurales ausentes';
  end if;
end;
$$;
