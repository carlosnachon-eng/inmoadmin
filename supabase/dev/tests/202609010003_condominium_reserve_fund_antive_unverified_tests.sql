-- Pruebas transaccionales DEV. No importan datos reales ni persisten evidencia.
begin;
set local statement_timeout = '45s';

do $$
begin
  if to_regprocedure('public.condominium_import_antive_reserve_fund_batch(uuid,uuid,text,text,jsonb,text,timestamptz,text)') is null
     or to_regprocedure('public.condominium_enrich_reserve_fund_receipt_evidence(uuid,date,text,text,text)') is null
     or to_regprocedure('public.condominium_void_reserve_fund_receipt(uuid,text)') is null
     or to_regprocedure('public.condominium_void_reserve_fund_batch(uuid,text)') is null then
    raise exception 'TEST: faltan funciones históricas Antive de Fondo de Reserva';
  end if;
end $$;

create temporary table reserve_antive_test_scope on commit drop as
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

create temporary table reserve_antive_invariants_before on commit drop as
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
  if (select count(*) from reserve_antive_test_scope) <> 1
     or (select admin_id is null or unidad_1 is null or unidad_2 is null or unidad_otro_tenant is null from reserve_antive_test_scope) then
    raise exception 'TEST: faltan administrador, unidades o segundo tenant DEV';
  end if;
end $$;

update public.condominium_operation_controls set real_payments_enabled = true
where condominio_id = (select condominio_id from reserve_antive_test_scope);
grant select on reserve_antive_test_scope to authenticated;
grant select on reserve_antive_invariants_before to authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select admin_id from reserve_antive_test_scope), 'role', 'authenticated'
)::text, true);
set local role authenticated;

-- Lote sintético: dos unidades reportadas como recibidas, sin comprobante, fecha ni referencia.
select public.condominium_import_antive_reserve_fund_batch(
  '93000000-0000-4000-8000-000000000001', condominio_id, repeat('a',64), 'TRANSICION-DEV',
  jsonb_build_array(
    jsonb_build_object(
      'receipt_id','93100000-0000-4000-8000-000000000001',
      'unidad_id',unidad_1,'amount',500,'source_range','K2',
      'idempotency_key','93200000-0000-4000-8000-000000000001'
    ),
    jsonb_build_object(
      'receipt_id','93100000-0000-4000-8000-000000000002',
      'unidad_id',unidad_2,'amount',500,'source_range','K3',
      'idempotency_key','93200000-0000-4000-8000-000000000002'
    )
  ), 'ANTIVE-QA', timestamptz '2099-01-01 12:00:00+00', 'Confirmación sintética DEV'
) from reserve_antive_test_scope;

do $$
declare
  scope reserve_antive_test_scope%rowtype;
  retry_batch public.condominium_reserve_fund_import_batches%rowtype;
  missing_evidence_blocked boolean := false;
  duplicate_source_blocked boolean := false;
  cross_tenant_blocked boolean := false;
begin
  select * into scope from reserve_antive_test_scope;
  if (select count(*) from public.condominium_reserve_fund_receipts
      where import_batch_id = '93000000-0000-4000-8000-000000000001'
        and status = 'received_by_antive_unverified' and record_kind = 'antive_historical_report'
        and source_organization = 'ANTIVE' and proof_date is null and deposit_date is null
        and payment_reference is null and evidence_path is null) <> 2 then
    raise exception 'TEST: lote recibido por Antive no conservó ausencia documental';
  end if;
  if (select coalesce(sum(total_amount),0) from public.condominium_reserve_fund_receipts
      where import_batch_id = '93000000-0000-4000-8000-000000000001') <> 1000 then
    raise exception 'TEST: importe del lote Antive incorrecto';
  end if;
  if exists(
    select 1 from public.condominium_reserve_fund_receipts
    where import_batch_id = '93000000-0000-4000-8000-000000000001' and status = 'pending'
  ) then raise exception 'TEST: recibido por Antive apareció pendiente de pago'; end if;

  select * into retry_batch from public.condominium_import_antive_reserve_fund_batch(
    '93000000-0000-4000-8000-000000000001', scope.condominio_id, repeat('a',64), 'TRANSICION-DEV',
    jsonb_build_array(
      jsonb_build_object('receipt_id','93100000-0000-4000-8000-000000000001','unidad_id',scope.unidad_1,'amount',500,'source_range','K2','idempotency_key','93200000-0000-4000-8000-000000000001'),
      jsonb_build_object('receipt_id','93100000-0000-4000-8000-000000000002','unidad_id',scope.unidad_2,'amount',500,'source_range','K3','idempotency_key','93200000-0000-4000-8000-000000000002')
    ), 'ANTIVE-QA', timestamptz '2099-01-01 12:00:00+00', 'Confirmación sintética DEV'
  );
  if retry_batch.id <> '93000000-0000-4000-8000-000000000001'
     or (select count(*) from public.condominium_reserve_fund_receipts where import_batch_id = retry_batch.id) <> 2 then
    raise exception 'TEST: reintento idempotente duplicó el lote';
  end if;

  begin
    perform public.condominium_reconcile_reserve_fund_receipt(
      '93100000-0000-4000-8000-000000000001', date '2099-01-02', 'ANTIVE-QA'
    );
  exception when check_violation then missing_evidence_blocked := true; end;
  if not missing_evidence_blocked then raise exception 'TEST: se concilió sin evidencia suficiente'; end if;

  begin
    perform public.condominium_import_antive_reserve_fund_batch(
      '93000000-0000-4000-8000-000000000003', scope.condominio_id, repeat('a',64), 'TRANSICION-DEV',
      jsonb_build_array(jsonb_build_object(
        'receipt_id','93100000-0000-4000-8000-000000000003','unidad_id',scope.unidad_1,
        'amount',500,'source_range','K2','idempotency_key','93200000-0000-4000-8000-000000000003'
      )), 'ANTIVE-QA', timestamptz '2099-01-01 12:00:00+00', null
    );
  exception when unique_violation then duplicate_source_blocked := true; end;
  if not duplicate_source_blocked then raise exception 'TEST: archivo/celda/unidad duplicados fueron aceptados'; end if;

  begin
    perform public.condominium_import_antive_reserve_fund_batch(
      '93000000-0000-4000-8000-000000000004', scope.condominio_id, repeat('b',64), 'TRANSICION-DEV',
      jsonb_build_array(jsonb_build_object(
        'receipt_id','93100000-0000-4000-8000-000000000004','unidad_id',scope.unidad_otro_tenant,
        'amount',500,'source_range','K4','idempotency_key','93200000-0000-4000-8000-000000000004'
      )), 'ANTIVE-QA', timestamptz '2099-01-01 12:00:00+00', null
    );
  exception when check_violation then cross_tenant_blocked := true; end;
  if not cross_tenant_blocked then raise exception 'TEST: se aceptó unidad de otro condominio'; end if;
end $$;

-- Enriquecimiento posterior: conserva el registro y habilita conciliación.
select public.condominium_enrich_reserve_fund_receipt_evidence(
  '93100000-0000-4000-8000-000000000001', date '2099-01-02', 'DEV-EVIDENCIA-ANTIVE',
  condominio_id::text || '/93100000-0000-4000-8000-000000000001.pdf', repeat('c',64)
) from reserve_antive_test_scope;

do $$
begin
  if not exists(
    select 1 from public.condominium_reserve_fund_receipts
    where id = '93100000-0000-4000-8000-000000000001'
      and status = 'received_by_antive_unverified'
      and payment_reference = 'DEV-EVIDENCIA-ANTIVE'
      and evidence_path is not null and evidence_enriched_by = (select admin_id from reserve_antive_test_scope)
      and evidence_enriched_at is not null
  ) then raise exception 'TEST: enriquecimiento alteró el origen o no quedó auditado'; end if;
end $$;

select public.condominium_reconcile_reserve_fund_receipt(
  '93100000-0000-4000-8000-000000000001', date '2099-01-03', 'ANTIVE-QA'
);
select public.condominium_reverse_reserve_fund_receipt(
  '93100000-0000-4000-8000-000000000001', 'Reversa sintética de evidencia DEV'
);
select public.condominium_void_reserve_fund_receipt(
  '93100000-0000-4000-8000-000000000002', 'Anulación sintética individual DEV'
);

-- Segundo lote: anulación atómica y reintento idempotente.
select public.condominium_import_antive_reserve_fund_batch(
  '93000000-0000-4000-8000-000000000005', condominio_id, repeat('d',64), 'TRANSICION-DEV',
  jsonb_build_array(
    jsonb_build_object('receipt_id','93100000-0000-4000-8000-000000000005','unidad_id',unidad_1,'amount',250,'source_range','L2','idempotency_key','93200000-0000-4000-8000-000000000005'),
    jsonb_build_object('receipt_id','93100000-0000-4000-8000-000000000006','unidad_id',unidad_2,'amount',250,'source_range','L3','idempotency_key','93200000-0000-4000-8000-000000000006')
  ), 'ANTIVE-QA', timestamptz '2099-01-04 12:00:00+00', null
) from reserve_antive_test_scope;
select public.condominium_void_reserve_fund_batch(
  '93000000-0000-4000-8000-000000000005', 'Anulación sintética de lote DEV'
);
select public.condominium_void_reserve_fund_batch(
  '93000000-0000-4000-8000-000000000005', 'Reintento idempotente de lote DEV'
);

do $$
declare batch_with_reconciled_blocked boolean := false;
begin
  if (select count(*) from public.condominium_reserve_fund_receipts
      where import_batch_id = '93000000-0000-4000-8000-000000000005'
        and status = 'voided' and voided_by = (select admin_id from reserve_antive_test_scope)) <> 2
     or not exists(
       select 1 from public.condominium_reserve_fund_import_batches
       where id = '93000000-0000-4000-8000-000000000005' and status = 'voided'
         and voided_by = (select admin_id from reserve_antive_test_scope)
     ) then raise exception 'TEST: anulación de lote incompleta'; end if;
  begin
    perform public.condominium_void_reserve_fund_batch(
      '93000000-0000-4000-8000-000000000001', 'Intento inválido sobre lote conciliado'
    );
  exception when check_violation then batch_with_reconciled_blocked := true; end;
  if not batch_with_reconciled_blocked then raise exception 'TEST: se anuló lote con registro conciliado/reversado'; end if;

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
  ) is distinct from (
    select row(fee_count,fee_total,account_count,historical_balance,recovery_count,recovered_total,expense_count,expense_total,portal_access_count)
    from reserve_antive_invariants_before
  ) then raise exception 'TEST: Fondo de Reserva alteró mantenimiento, históricos, recuperaciones, gastos, KPI o portal'; end if;
end $$;

-- Externo/no autorizado: cero lectura y cero escritura.
reset role;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'ffffffff-ffff-4fff-8fff-fffffffff303', 'role', 'authenticated'
)::text, true);
set local role authenticated;
do $$
declare denied boolean := false;
begin
  if (select count(*) from public.condominium_reserve_fund_import_batches) <> 0
     or (select count(*) from public.condominium_reserve_fund_receipts) <> 0
     or (select count(*) from public.condominium_reserve_fund_contributions) <> 0 then
    raise exception 'TEST: usuario externo ve datos de Fondo de Reserva';
  end if;
  begin
    perform public.condominium_void_reserve_fund_receipt(
      '93100000-0000-4000-8000-000000000002', 'Intento externo bloqueado'
    );
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'TEST: usuario externo operó Fondo de Reserva'; end if;
end $$;

reset role;
select 'CONDOMINIUM_RESERVE_FUND_ANTIVE_TESTS_OK' as result;
rollback;
