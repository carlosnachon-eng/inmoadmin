do $$
declare t text; n bigint;
begin
  foreach t in array array['condominium_financial_controls','condominium_funds','condominium_bank_accounts','condominium_charge_concepts','condominium_charges','condominium_bank_transactions','condominium_receipts','condominium_payment_applications','condominium_bank_matches','condominium_reconciliations','condominium_financial_periods','condominium_financial_events','condominium_journal_entries','condominium_journal_lines'] loop
    if to_regclass('public.'||t) is null then raise exception 'FINANCIAL_CORE_OBJECT_MISSING:%',t; end if;
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=t and c.relrowsecurity and c.relforcerowsecurity) then raise exception 'FINANCIAL_CORE_RLS_INVALID:%',t; end if;
  end loop;
  if exists(select 1 from public.condominium_financial_controls where ledger_enabled) then raise exception 'REAL_CONDOMINIUM_LEDGER_ENABLED'; end if;
  foreach t in array array['condominium_charges','condominium_bank_transactions','condominium_receipts','condominium_payment_applications','condominium_bank_matches','condominium_reconciliations','condominium_financial_events','condominium_journal_entries','condominium_journal_lines'] loop
    execute format('select count(*) from public.%I',t) into n; if n<>0 then raise exception 'FINANCIAL_CORE_NOT_INERT:%:%',t,n; end if;
  end loop;
  if not exists(select 1 from storage.buckets where id='condominium-financial-evidence' and not public and file_size_limit=5242880) then raise exception 'FINANCIAL_EVIDENCE_BUCKET_INVALID'; end if;
  if exists(select 1 from storage.objects where bucket_id='condominium-financial-evidence') then raise exception 'FINANCIAL_EVIDENCE_BUCKET_NOT_EMPTY'; end if;
  if has_table_privilege('anon','public.condominium_charges','SELECT') or has_table_privilege('anon','public.condominium_charges','INSERT') then raise exception 'ANON_FINANCIAL_PRIVILEGE'; end if;
  if has_table_privilege('authenticated','public.condominium_charges','INSERT') or has_table_privilege('authenticated','public.condominium_charges','UPDATE') or has_table_privilege('authenticated','public.condominium_charges','DELETE') then raise exception 'CLIENT_FINANCIAL_DML_PRIVILEGE'; end if;
  if exists(select 1 from pg_trigger where tgrelid in ('public.cuotas_condominio'::regclass,'public.gastos_condominio'::regclass) and tgname like 'financial_%') then raise exception 'LEGACY_FINANCIAL_TRIGGER_PRESENT'; end if;
end $$;
select 'CONDOMINIUM_FINANCIAL_CORE_V1_POSTCHECK_OK' as result;
