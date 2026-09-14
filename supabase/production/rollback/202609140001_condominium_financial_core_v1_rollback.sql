-- Run only after removing the empty private bucket through the Storage API.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $$
declare t text; n bigint;
begin
  if exists(select 1 from storage.objects where bucket_id='condominium-financial-evidence') then
    raise exception 'FINANCIAL_CORE_ROLLBACK_BLOCKED_EVIDENCE_EXISTS';
  end if;
  if exists(select 1 from storage.buckets where id='condominium-financial-evidence') then
    raise exception 'FINANCIAL_CORE_ROLLBACK_REQUIRES_EMPTY_BUCKET_REMOVAL_VIA_STORAGE_API';
  end if;
  foreach t in array array['condominium_charges','condominium_bank_transactions','condominium_receipts','condominium_payment_applications','condominium_bank_matches','condominium_reconciliations','condominium_financial_events','condominium_journal_entries','condominium_journal_lines'] loop
    execute format('select count(*) from public.%I',t) into n;
    if n<>0 then raise exception 'FINANCIAL_CORE_ROLLBACK_BLOCKED_ACTIVITY:%:%',t,n; end if;
  end loop;
end $$;

drop view if exists public.condominium_financial_ledger_balances;
drop view if exists public.condominium_financial_charge_balances;
drop table if exists public.condominium_financial_events;
drop table if exists public.condominium_bank_matches;
drop table if exists public.condominium_payment_applications;
drop table if exists public.condominium_journal_lines;
drop table if exists public.condominium_journal_entries;
drop table if exists public.condominium_reconciliations;
drop table if exists public.condominium_receipts;
drop table if exists public.condominium_bank_transactions;
drop table if exists public.condominium_charges;
drop table if exists public.condominium_financial_periods;
drop table if exists public.condominium_charge_concepts;
drop table if exists public.condominium_bank_accounts;
drop table if exists public.condominium_funds;
drop table if exists public.condominium_financial_controls;

drop function if exists public.condominium_financial_reverse_receipt(uuid,uuid,uuid,text,uuid);
drop function if exists public.condominium_financial_confirm_receipt(uuid,uuid,uuid,uuid);
drop function if exists public.condominium_financial_match_bank_receipt(uuid,uuid,uuid,numeric,uuid);
drop function if exists public.condominium_financial_apply_receipt(uuid,uuid,jsonb);
drop function if exists public.condominium_financial_create_receipt(uuid,uuid,uuid,date,numeric,text,text,text,uuid);
drop function if exists public.condominium_financial_identify_bank_transaction(uuid,uuid,uuid);
drop function if exists public.condominium_financial_import_bank_transaction(uuid,uuid,uuid,date,date,text,numeric,text,text,text,uuid);
drop function if exists public.condominium_financial_create_charge(uuid,uuid,uuid,uuid,uuid,numeric,date,text,uuid);
drop function if exists public.condominium_financial_post_entry(uuid);
drop function if exists public.condominium_financial_period_assert(uuid,uuid);
drop function if exists public.condominium_financial_assert(uuid,boolean);
drop function if exists public.condominium_financial_immutable_guard();

commit;
