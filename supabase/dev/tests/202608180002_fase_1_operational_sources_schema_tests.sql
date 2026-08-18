-- READ-ONLY checks posteriores al bootstrap DEV 202608180002.
-- No inserta, actualiza ni elimina datos.

do $$
declare
  table_name text;
  expected_tables constant text[] := array[
    'servicios_inmueble', 'pagos_servicios', 'owner_payments',
    'owner_payment_receipts', 'property_expenses', 'comisiones_admin', 'llaves'
  ];
begin
  foreach table_name in array expected_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'Falta tabla public.%', table_name;
    end if;
    if coalesce(obj_description(to_regclass(format('public.%I', table_name)), 'pg_class'), '')
       <> 'dev-bootstrap:202608180002:fase-1-operational-sources' then
      raise exception 'Tabla public.% sin marcador del bootstrap', table_name;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name and c.relrowsecurity
    ) then
      raise exception 'RLS no habilitado en public.%', table_name;
    end if;
    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
       or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
       or has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
       or has_table_privilege('anon', format('public.%I', table_name), 'DELETE') then
      raise exception 'anon conserva privilegios sobre public.%', table_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(expected_tables)
      and (lower(pg_get_expr(p.polqual, p.polrelid)) = 'true'
           or lower(pg_get_expr(p.polwithcheck, p.polrelid)) = 'true')
  ) then
    raise exception 'Existe policy USING true o WITH CHECK true en el bootstrap';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='servicios_inmueble'
      and column_name='periodicidad' and data_type='text' and column_default like '%mensual%'
  ) then raise exception 'servicios_inmueble.periodicidad incompatible'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='pagos_servicios'
      and column_name='gasto_id' and udt_name='uuid'
  ) then raise exception 'pagos_servicios.gasto_id incompatible'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='owner_payments'
      and column_name='amount_paid' and data_type='numeric' and numeric_precision=10 and numeric_scale=2
  ) then raise exception 'owner_payments.amount_paid incompatible'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='owner_payment_receipts'
      and column_name='comprobante_url' and data_type='text'
  ) then raise exception 'owner_payment_receipts.comprobante_url incompatible'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.comisiones_admin'::regclass and contype='u'
  ) then raise exception 'Falta unique de comisiones_admin'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.pagos_servicios'::regclass and contype='f'
      and confrelid='public.property_expenses'::regclass
  ) then raise exception 'Falta FK pagos_servicios -> property_expenses'; end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='llaves'
      and indexname='llaves_numero_activa_unique' and indexdef ilike '%where (activa = true)%'
  ) then raise exception 'Falta unique parcial de llaves activas'; end if;
end;
$$;
