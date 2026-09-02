-- Postcheck de instalación. Ejecutar antes de importar datos o evidencia real.
-- Sólo lectura.

do $$
declare
  table_name text;
  policy_count integer;
  storage_policy_count integer;
  function_count integer;
begin
  if to_regclass('public.condominium_reserve_fund_receipts') is null
     or to_regclass('public.condominium_reserve_fund_contributions') is null then
    raise exception 'POSTCHECK: faltan tablas de Fondo de Reserva.';
  end if;
  if exists(select 1 from public.condominium_reserve_fund_receipts)
     or exists(select 1 from public.condominium_reserve_fund_contributions) then
    raise exception 'POSTCHECK: la instalación debía terminar sin datos.';
  end if;
  if exists(select 1 from storage.objects where bucket_id = 'condominium-reserve-fund-evidence') then
    raise exception 'POSTCHECK: la instalación debía terminar sin evidencia.';
  end if;
  if not exists(
    select 1 from storage.buckets
    where id = 'condominium-reserve-fund-evidence'
      and public = false and file_size_limit = 5242880
      and allowed_mime_types = array['application/pdf','image/jpeg','image/png']::text[]
  ) then
    raise exception 'POSTCHECK: bucket privado ausente o con configuración inesperada.';
  end if;

  foreach table_name in array array['condominium_reserve_fund_receipts','condominium_reserve_fund_contributions'] loop
    if not exists(
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name and c.relrowsecurity and c.relforcerowsecurity
    ) then raise exception 'POSTCHECK: RLS/FORCE RLS ausente en %.', table_name; end if;
    select count(*) into policy_count from pg_policies
    where schemaname = 'public' and tablename = table_name;
    if policy_count <> 1 or not exists(
      select 1 from pg_policies
      where schemaname = 'public' and tablename = table_name and cmd = 'SELECT'
        and roles = array['authenticated']::name[] and qual like '%condominium_internal_permission%'
    ) then raise exception 'POSTCHECK: policies inesperadas en %.', table_name; end if;
    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
       or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
       or has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
       or has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
       or has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') then
      raise exception 'POSTCHECK: privilegios cliente demasiado amplios en %.', table_name;
    end if;
    if not has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') then
      raise exception 'POSTCHECK: falta SELECT autenticado sujeto a RLS en %.', table_name;
    end if;
  end loop;

  select count(*) into storage_policy_count from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and (qual like '%condominium-reserve-fund-evidence%' or with_check like '%condominium-reserve-fund-evidence%');
  if storage_policy_count <> 0 then
    raise exception 'POSTCHECK: el bucket privado no debe exponerse por policies cliente.';
  end if;

  select count(*) into function_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'condominium_create_reserve_fund_receipt',
      'condominium_reconcile_reserve_fund_receipt',
      'condominium_reverse_reserve_fund_receipt'
    ) and p.prosecdef = true and p.proconfig @> array['search_path=public, pg_temp'];
  if function_count <> 3 then
    raise exception 'POSTCHECK: funciones privilegiadas ausentes o sin search_path seguro.';
  end if;

  if has_function_privilege('anon', 'public.condominium_create_reserve_fund_receipt(uuid,uuid,jsonb,text,date,text,text,text,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.condominium_create_reserve_fund_receipt(uuid,uuid,jsonb,text,date,text,text,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.condominium_reconcile_reserve_fund_receipt(uuid,date,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.condominium_reverse_reserve_fund_receipt(uuid,text)', 'EXECUTE') then
    raise exception 'POSTCHECK: ejecución privilegiada expuesta fuera del operador autenticado.';
  end if;
  if not has_function_privilege('authenticated', 'public.condominium_create_reserve_fund_receipt(uuid,uuid,jsonb,text,date,text,text,text,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.condominium_reconcile_reserve_fund_receipt(uuid,date,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.condominium_reverse_reserve_fund_receipt(uuid,text)', 'EXECUTE') then
    raise exception 'POSTCHECK: faltan grants de ejecución autenticada sujetos a validación interna.';
  end if;
end $$;

select 'CONDOMINIUM_RESERVE_FUND_POSTCHECK_OK' as result;
