do $$
declare
  guard_definition text;
  table_name text;
  activity_count bigint;
begin
  if to_regclass('public.condominium_financial_controls') is null then
    raise exception 'LEGACY_EXPENSE_GATE_FINANCIAL_CONTROLS_MISSING';
  end if;

  select pg_get_functiondef('public.condominium_expense_operation_guard()'::regprocedure)
  into guard_definition;
  if position('condominium_financial_controls' in guard_definition) = 0
     or position('LEGACY_EXPENSE_BLOCKED_LEDGER_ACTIVE' in guard_definition) = 0
     or position('money_movements_enabled' in guard_definition) > 0 then
    raise exception 'LEGACY_EXPENSE_GATE_FUNCTION_INVALID';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.gastos_condominio'::regclass
      and tgname = 'condominium_expense_operation_guard'
      and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'LEGACY_EXPENSE_GATE_TRIGGER_INVALID';
  end if;

  if has_function_privilege('anon','public.condominium_expense_operation_guard()','EXECUTE')
     or has_function_privilege('authenticated','public.condominium_expense_operation_guard()','EXECUTE') then
    raise exception 'LEGACY_EXPENSE_GATE_FUNCTION_EXECUTION_EXPOSED';
  end if;

  if exists(select 1 from public.condominium_financial_controls where ledger_enabled) then
    raise exception 'REAL_CONDOMINIUM_LEDGER_ENABLED';
  end if;

  foreach table_name in array array[
    'condominium_charges','condominium_bank_transactions','condominium_receipts',
    'condominium_payment_applications','condominium_bank_matches','condominium_reconciliations',
    'condominium_financial_events','condominium_journal_entries','condominium_journal_lines'
  ] loop
    execute format('select count(*) from public.%I',table_name) into activity_count;
    if activity_count<>0 then
      raise exception 'FINANCIAL_CORE_NOT_INERT:%:%',table_name,activity_count;
    end if;
  end loop;
end $$;

select 'CONDOMINIUM_LEGACY_EXPENSE_LEDGER_GATE_POSTCHECK_OK' as result;
