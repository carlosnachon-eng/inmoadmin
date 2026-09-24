-- Restaura únicamente el guard anterior. No modifica datos ni controles.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare guard_definition text;
begin
  select pg_get_functiondef('public.condominium_expense_operation_guard()'::regprocedure)
  into guard_definition;
  if position('LEGACY_EXPENSE_BLOCKED_LEDGER_ACTIVE' in guard_definition) = 0
     or position('condominium_financial_controls' in guard_definition) = 0 then
    raise exception 'LEGACY_EXPENSE_GATE_ROLLBACK_UNEXPECTED_BASELINE';
  end if;
end $$;

create or replace function public.condominium_expense_operation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_condominium_id uuid;
  allowed boolean;
begin
  target_condominium_id := case
    when tg_op = 'DELETE' then old.condominio_id
    else new.condominio_id
  end;

  select c.money_movements_enabled into allowed
  from public.condominium_operation_controls c
  where c.condominio_id = target_condominium_id;
  if found and not allowed then
    raise exception using errcode = '55000', message = 'Los gastos y movimientos reales están bloqueados durante preimplementación.';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.condominium_expense_operation_guard() from public, anon, authenticated;
commit;
