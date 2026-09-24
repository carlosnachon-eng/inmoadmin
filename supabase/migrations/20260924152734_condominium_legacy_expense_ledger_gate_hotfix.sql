-- Hotfix: los gastos legacy dependen exclusivamente del opt-in de Financial Core.
-- RLS conserva la autoridad para decidir qué identidades pueden escribir.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  guard_definition text;
begin
  if to_regclass('public.gastos_condominio') is null
     or to_regclass('public.condominium_financial_controls') is null
     or to_regprocedure('public.condominium_expense_operation_guard()') is null then
    raise exception 'LEGACY_EXPENSE_GATE_DEPENDENCY_MISSING';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.gastos_condominio'::regclass
      and tgname = 'condominium_expense_operation_guard'
      and not tgisinternal
  ) then
    raise exception 'LEGACY_EXPENSE_GATE_TRIGGER_MISSING';
  end if;

  select pg_get_functiondef('public.condominium_expense_operation_guard()'::regprocedure)
  into guard_definition;
  if position('money_movements_enabled' in guard_definition) = 0 then
    raise exception 'LEGACY_EXPENSE_GATE_UNEXPECTED_BASELINE';
  end if;
end $$;

create or replace function public.condominium_expense_operation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_condominium_id uuid;
  ledger_is_enabled boolean;
begin
  target_condominium_id := case
    when tg_op = 'DELETE' then old.condominio_id
    else new.condominio_id
  end;

  select coalesce(c.ledger_enabled, false)
    into ledger_is_enabled
  from public.condominium_financial_controls c
  where c.condominio_id = target_condominium_id;

  if coalesce(ledger_is_enabled, false) then
    raise exception using
      errcode = '55000',
      message = 'LEGACY_EXPENSE_BLOCKED_LEDGER_ACTIVE';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.condominium_expense_operation_guard() from public, anon, authenticated;

commit;
