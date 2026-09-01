-- Rollback conservador: sólo antes de registrar comprobantes, aplicaciones o evidencia.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.condominium_reserve_fund_receipts') is not null
     and exists(select 1 from public.condominium_reserve_fund_receipts) then
    raise exception 'ROLLBACK ABORTADO: existen comprobantes de Fondo de Reserva; no se eliminarán.';
  end if;
  if to_regclass('public.condominium_reserve_fund_contributions') is not null
     and exists(select 1 from public.condominium_reserve_fund_contributions) then
    raise exception 'ROLLBACK ABORTADO: existen aplicaciones de Fondo de Reserva; no se eliminarán.';
  end if;
  if exists(select 1 from storage.objects where bucket_id = 'condominium-reserve-fund-evidence') then
    raise exception 'ROLLBACK ABORTADO: existe evidencia privada; no se eliminará.';
  end if;
end $$;

drop function if exists public.condominium_reverse_reserve_fund_receipt(uuid,text);
drop function if exists public.condominium_reconcile_reserve_fund_receipt(uuid,date,text);
drop function if exists public.condominium_create_reserve_fund_receipt(uuid,uuid,jsonb,text,date,text,text,text,uuid);
drop trigger if exists condominium_reserve_fund_contribution_operation_guard on public.condominium_reserve_fund_contributions;
drop trigger if exists condominium_reserve_fund_receipt_operation_guard on public.condominium_reserve_fund_receipts;
drop function if exists public.condominium_reserve_fund_contribution_guard();
drop function if exists public.condominium_reserve_fund_receipt_guard();
drop table if exists public.condominium_reserve_fund_contributions;
drop table if exists public.condominium_reserve_fund_receipts;

-- Supabase protege storage.buckets contra DELETE SQL directo. El bucket vacío,
-- privado y sin policies se conserva para evitar una eliminación insegura.
commit;
