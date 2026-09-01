-- Rollback conservador: sólo procede antes de registrar aportaciones o evidencia.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.condominium_reserve_fund_contributions') is not null
     and exists(select 1 from public.condominium_reserve_fund_contributions) then
    raise exception 'ROLLBACK ABORTADO: existen aportaciones al Fondo de Reserva; no se eliminarán.';
  end if;
  if exists(
    select 1 from storage.objects
    where bucket_id = 'condominium-reserve-fund-evidence'
  ) then
    raise exception 'ROLLBACK ABORTADO: existe evidencia privada; no se eliminará.';
  end if;
end $$;

drop function if exists public.condominium_reverse_reserve_fund_contribution(uuid,text);
drop function if exists public.condominium_reconcile_reserve_fund_contribution(uuid,date,text);
drop function if exists public.condominium_create_reserve_fund_contribution(uuid,uuid,uuid,numeric,text,date,text,text,text,uuid);
drop trigger if exists condominium_reserve_fund_contribution_operation_guard
on public.condominium_reserve_fund_contributions;
drop function if exists public.condominium_reserve_fund_contribution_guard();
drop table if exists public.condominium_reserve_fund_contributions;

-- Supabase protege storage.buckets contra DELETE SQL directo. El bucket vacío,
-- privado y sin políticas se conserva para evitar una eliminación insegura por SQL.

commit;
