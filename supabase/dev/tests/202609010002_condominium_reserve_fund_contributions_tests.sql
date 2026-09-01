-- Pruebas transaccionales DEV. No persisten movimientos ni cambian controles.
begin;
set local statement_timeout = '30s';

do $$
begin
  if to_regprocedure('public.condominium_create_reserve_fund_receipt(uuid,uuid,jsonb,text,date,text,text,text,uuid)') is null
     or to_regprocedure('public.condominium_reconcile_reserve_fund_receipt(uuid,date,text)') is null
     or to_regprocedure('public.condominium_reverse_reserve_fund_receipt(uuid,text)') is null then
    raise exception 'TEST: faltan funciones de Fondo de Reserva';
  end if;
  if (select public from storage.buckets where id = 'condominium-reserve-fund-evidence') is distinct from false then
    raise exception 'TEST: bucket de evidencia no es privado';
  end if;
end $$;

create temporary table reserve_fund_test_scope on commit drop as
select
  c.id as condominio_id,
  (select u.id from public.unidades_condominio u where u.condominio_id = c.id and u.activo order by u.numero limit 1) as unidad_1,
  (select u.id from public.unidades_condominio u where u.condominio_id = c.id and u.activo order by u.numero offset 1 limit 1) as unidad_2,
  (select u.id from public.unidades_condominio u where u.condominio_id <> c.id and u.activo order by u.condominio_id,u.numero limit 1) as unidad_otro_tenant,
  (select p.id from public.profiles p where p.active and p.role_id = 'admin' order by p.id limit 1) as admin_id
from public.condominios c
where exists(select 1 from public.condominium_operation_controls o where o.condominio_id = c.id)
  and (select count(*) from public.unidades_condominio u where u.condominio_id = c.id and u.activo) >= 2
  and exists(select 1 from public.unidades_condominio u where u.condominio_id <> c.id and u.activo)
order by c.id limit 1;

create temporary table reserve_fund_unchanged_before on commit drop as
select
  (select count(*) from public.cuotas_condominio) fee_count,
  (select coalesce(sum(monto),0) from public.cuotas_condominio) fee_total,
  (select count(*) from public.condominium_historical_accounts) account_count,
  (select coalesce(sum(reported_balance),0) from public.condominium_historical_accounts) historical_balance,
  (select count(*) from public.condominium_historical_recoveries) recovery_count,
  (select coalesce(sum(amount),0) from public.condominium_historical_recoveries where status = 'APLICADO') recovered_total,
  (select count(*) from public.gastos_condominio) expense_count,
  (select coalesce(sum(monto),0) from public.gastos_condominio) expense_total,
  (select count(*) from public.condominium_unit_portal_access) portal_access_count;

do $$
begin
  if (select count(*) from reserve_fund_test_scope) <> 1
     or (select admin_id is null or unidad_1 is null or unidad_2 is null or unidad_otro_tenant is null from reserve_fund_test_scope) then
    raise exception 'TEST: faltan administrador, dos unidades o segundo tenant DEV';
  end if;
end $$;

update public.condominium_operation_controls set real_payments_enabled = true
where condominio_id = (select condominio_id from reserve_fund_test_scope);
grant select on reserve_fund_test_scope to authenticated;
grant select on reserve_fund_unchanged_before to authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select admin_id from reserve_fund_test_scope), 'role', 'authenticated'
)::text, true);
set local role authenticated;

-- Un solo comprobante distribuye $1,200 entre dos unidades y se crea atómicamente.
select public.condominium_create_reserve_fund_receipt(
  '91000000-0000-4000-8000-000000000001', condominio_id,
  jsonb_build_array(
    jsonb_build_object('unidad_id', unidad_1, 'amount', 500),
    jsonb_build_object('unidad_id', unidad_2, 'amount', 700)
  ),
  'ANTIVE', current_date, 'DEV-RESERVE-MULTIUNIT',
  condominio_id::text || '/91000000-0000-4000-8000-000000000001.pdf',
  repeat('1',64), '92000000-0000-4000-8000-000000000001'
) from reserve_fund_test_scope;

do $$
declare
  scope reserve_fund_test_scope%rowtype;
  first_row public.condominium_reserve_fund_receipts%rowtype;
  retry_row public.condominium_reserve_fund_receipts%rowtype;
  duplicate_blocked boolean := false;
  cross_tenant_blocked boolean := false;
begin
  select * into scope from reserve_fund_test_scope;
  select * into first_row from public.condominium_reserve_fund_receipts where id = '91000000-0000-4000-8000-000000000001';
  if first_row.status <> 'pending' or first_row.deposit_date is not null or first_row.total_amount <> 1200 then
    raise exception 'TEST: el comprobante multiunidad no inició pendiente por $1,200';
  end if;
  if (select count(*) from public.condominium_reserve_fund_contributions where receipt_id = first_row.id) <> 2
     or (select sum(amount) from public.condominium_reserve_fund_contributions where receipt_id = first_row.id) <> 1200 then
    raise exception 'TEST: aplicaciones multiunidad incompletas';
  end if;

  select * into retry_row from public.condominium_create_reserve_fund_receipt(
    first_row.id, scope.condominio_id,
    jsonb_build_array(
      jsonb_build_object('unidad_id', scope.unidad_1, 'amount', 500),
      jsonb_build_object('unidad_id', scope.unidad_2, 'amount', 700)
    ), 'ANTIVE', first_row.proof_date, 'DEV-RESERVE-MULTIUNIT', first_row.evidence_path,
    repeat('1',64), '92000000-0000-4000-8000-000000000001'
  );
  if retry_row.id <> first_row.id
     or (select count(*) from public.condominium_reserve_fund_contributions where receipt_id = first_row.id) <> 2 then
    raise exception 'TEST: reintento idempotente duplicó datos';
  end if;

  begin
    perform public.condominium_create_reserve_fund_receipt(
      '91000000-0000-4000-8000-000000000002', scope.condominio_id,
      jsonb_build_array(jsonb_build_object('unidad_id', scope.unidad_1, 'amount', 500)),
      'ANTIVE', current_date, 'DEV-RESERVE-DUPLICATE',
      scope.condominio_id::text || '/91000000-0000-4000-8000-000000000002.pdf',
      repeat('1',64), '92000000-0000-4000-8000-000000000002'
    );
  exception when unique_violation then duplicate_blocked := true; end;
  if not duplicate_blocked then raise exception 'TEST: evidencia duplicada fue aceptada'; end if;

  begin
    perform public.condominium_create_reserve_fund_receipt(
      '91000000-0000-4000-8000-000000000003', scope.condominio_id,
      jsonb_build_array(jsonb_build_object('unidad_id', scope.unidad_otro_tenant, 'amount', 500)),
      'ANTIVE', current_date, 'DEV-RESERVE-CROSS-TENANT',
      scope.condominio_id::text || '/91000000-0000-4000-8000-000000000003.pdf',
      repeat('3',64), '92000000-0000-4000-8000-000000000003'
    );
  exception when check_violation then cross_tenant_blocked := true; end;
  if not cross_tenant_blocked then raise exception 'TEST: se aceptó una unidad de otro tenant'; end if;
end $$;

select public.condominium_reconcile_reserve_fund_receipt(
  '91000000-0000-4000-8000-000000000001', date '2099-12-01', 'CONFIRMACION-ANTIVE-DEV'
);

do $$
begin
  if not exists(
    select 1 from public.condominium_reserve_fund_receipts
    where id = '91000000-0000-4000-8000-000000000001'
      and status = 'reconciled' and total_amount = 1200 and deposit_date = date '2099-12-01'
      and bank_confirmed_by = 'CONFIRMACION-ANTIVE-DEV'
      and reconciled_by = (select admin_id from reserve_fund_test_scope) and reconciled_at is not null
  ) then raise exception 'TEST: conciliación multiunidad incompleta'; end if;
  if (select count(*) from public.condominium_reserve_fund_contributions where receipt_id = '91000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'TEST: conciliación alteró aplicaciones';
  end if;
end $$;

select public.condominium_reverse_reserve_fund_receipt(
  '91000000-0000-4000-8000-000000000001', 'Reversión sintética controlada DEV'
);

do $$
begin
  if not exists(
    select 1 from public.condominium_reserve_fund_receipts
    where id = '91000000-0000-4000-8000-000000000001' and status = 'reversed'
      and total_amount = 1200 and reversal_reason = 'Reversión sintética controlada DEV'
      and reversed_by = (select admin_id from reserve_fund_test_scope) and reversed_at is not null
  ) then raise exception 'TEST: reversión incompleta'; end if;

  if row(
    (select count(*) from public.cuotas_condominio),
    (select coalesce(sum(monto),0) from public.cuotas_condominio),
    (select count(*) from public.condominium_historical_accounts),
    (select coalesce(sum(reported_balance),0) from public.condominium_historical_accounts),
    (select count(*) from public.condominium_historical_recoveries),
    (select coalesce(sum(amount),0) from public.condominium_historical_recoveries where status = 'APLICADO'),
    (select count(*) from public.gastos_condominio),
    (select coalesce(sum(monto),0) from public.gastos_condominio),
    (select count(*) from public.condominium_unit_portal_access)
  ) is distinct from (select row(fee_count,fee_total,account_count,historical_balance,recovery_count,recovered_total,expense_count,expense_total,portal_access_count) from reserve_fund_unchanged_before) then
    raise exception 'TEST: Fondo de Reserva modificó cuotas, históricos, recuperaciones, gastos o portal';
  end if;
end $$;

-- Identidad externa/no autorizada: cero lectura y cero operación.
reset role;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'ffffffff-ffff-4fff-8fff-fffffffff301', 'role', 'authenticated'
)::text, true);
set local role authenticated;
do $$
declare visible_receipts integer; visible_allocations integer; denied boolean := false;
begin
  select count(*) into visible_receipts from public.condominium_reserve_fund_receipts;
  select count(*) into visible_allocations from public.condominium_reserve_fund_contributions;
  if visible_receipts <> 0 or visible_allocations <> 0 then
    raise exception 'TEST: identidad externa ve Fondo de Reserva';
  end if;
  begin
    perform public.condominium_reverse_reserve_fund_receipt(
      '91000000-0000-4000-8000-000000000001', 'Intento externo bloqueado'
    );
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'TEST: identidad externa operó Fondo de Reserva'; end if;
end $$;

reset role;
select 'CONDOMINIUM_RESERVE_FUND_TESTS_OK' as result;
rollback;
