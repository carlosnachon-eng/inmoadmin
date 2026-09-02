-- Postcheck de instalación. Sólo lectura; ejecutar antes de importar lotes reales.

do $$
declare
  function_count integer;
  policy_count integer;
begin
  if to_regclass('public.condominium_reserve_fund_import_batches') is null then
    raise exception 'POSTCHECK: falta tabla de lotes históricos Antive.';
  end if;
  if exists(select 1 from public.condominium_reserve_fund_import_batches)
     or exists(
       select 1 from public.condominium_reserve_fund_receipts
       where record_kind = 'antive_historical_report'
          or status in ('received_by_antive_unverified','voided')
     ) then
    raise exception 'POSTCHECK: la instalación no debía importar registros históricos reales.';
  end if;
  if exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'condominium_reserve_fund_receipts'
      and column_name in ('proof_date','payment_reference','evidence_path','evidence_sha256')
      and is_nullable <> 'YES'
  ) then
    raise exception 'POSTCHECK: los metadatos bancarios deben admitir ausencia documental inicial.';
  end if;
  if not exists(
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'condominium_reserve_fund_import_batches'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'POSTCHECK: RLS/FORCE RLS ausente en lotes históricos Antive.';
  end if;
  select count(*) into policy_count from pg_policies
  where schemaname = 'public' and tablename = 'condominium_reserve_fund_import_batches';
  if policy_count <> 1 or not exists(
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'condominium_reserve_fund_import_batches'
      and cmd = 'SELECT' and roles = array['authenticated']::name[]
      and qual like '%condominium_internal_permission%'
  ) then
    raise exception 'POSTCHECK: policy inesperada en lotes históricos Antive.';
  end if;
  if has_table_privilege('anon', 'public.condominium_reserve_fund_import_batches', 'SELECT')
     or has_table_privilege('authenticated', 'public.condominium_reserve_fund_import_batches', 'INSERT')
     or has_table_privilege('authenticated', 'public.condominium_reserve_fund_import_batches', 'UPDATE')
     or has_table_privilege('authenticated', 'public.condominium_reserve_fund_import_batches', 'DELETE') then
    raise exception 'POSTCHECK: privilegios cliente demasiado amplios en lotes históricos Antive.';
  end if;
  if not has_table_privilege('authenticated', 'public.condominium_reserve_fund_import_batches', 'SELECT') then
    raise exception 'POSTCHECK: falta SELECT autenticado sujeto a RLS.';
  end if;

  select count(*) into function_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'condominium_import_antive_reserve_fund_batch',
      'condominium_enrich_reserve_fund_receipt_evidence',
      'condominium_void_reserve_fund_receipt',
      'condominium_void_reserve_fund_batch'
    )
    and p.prosecdef = true and p.proconfig @> array['search_path=public, pg_temp'];
  if function_count <> 4 then
    raise exception 'POSTCHECK: faltan funciones privilegiadas o search_path seguro.';
  end if;
  if has_function_privilege('anon', 'public.condominium_import_antive_reserve_fund_batch(uuid,uuid,text,text,jsonb,text,timestamptz,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.condominium_import_antive_reserve_fund_batch(uuid,uuid,text,text,jsonb,text,timestamptz,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.condominium_enrich_reserve_fund_receipt_evidence(uuid,date,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.condominium_void_reserve_fund_receipt(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.condominium_void_reserve_fund_batch(uuid,text)', 'EXECUTE') then
    raise exception 'POSTCHECK: RPC histórica expuesta fuera del operador autenticado.';
  end if;
  if not has_function_privilege('authenticated', 'public.condominium_import_antive_reserve_fund_batch(uuid,uuid,text,text,jsonb,text,timestamptz,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.condominium_enrich_reserve_fund_receipt_evidence(uuid,date,text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.condominium_void_reserve_fund_receipt(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.condominium_void_reserve_fund_batch(uuid,text)', 'EXECUTE') then
    raise exception 'POSTCHECK: faltan grants autenticados sujetos a validación interna.';
  end if;
  if not exists(
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'condominium_reserve_fund_antive_source_unique'
      and indexdef like '%source_file_sha256%source_sheet%source_range%source_unit_id%'
  ) then
    raise exception 'POSTCHECK: falta idempotencia por archivo, hoja, celda y unidad.';
  end if;
  if not exists(
    select 1 from storage.buckets
    where id = 'condominium-reserve-fund-evidence' and public = false
  ) then
    raise exception 'POSTCHECK: el bucket de evidencia dejó de ser privado.';
  end if;
end $$;

select 'CONDOMINIUM_RESERVE_FUND_ANTIVE_POSTCHECK_OK' as result;
