-- Pruebas transaccionales DEV. No persisten recuperaciones, cuotas ni cambios de control.
begin;
set local statement_timeout='30s';

do $$
begin
  if to_regprocedure('public.condominium_create_historical_recovery(uuid,uuid,uuid,uuid,numeric,numeric,text,timestamp with time zone,text,text,uuid,uuid)') is null
     or to_regprocedure('public.condominium_apply_historical_recovery(uuid,date,text)') is null
     or to_regprocedure('public.condominium_reverse_historical_recovery(uuid,text)') is null then
    raise exception 'TEST: faltan funciones de recuperación histórica';
  end if;
  if (select public from storage.buckets where id='condominium-historical-evidence') is distinct from false then
    raise exception 'TEST: bucket de evidencia no es privado';
  end if;
end $$;

create temporary table recovery_test_scope on commit drop as
select
  h.condominio_id,
  h.unidad_id,
  h.id as historical_account_id,
  h.reported_balance,
  (select p.id from public.profiles p where p.active=true and p.role_id='admin' order by p.id limit 1) as admin_id
from public.condominium_historical_accounts h
join public.condominium_operation_controls c on c.condominio_id=h.condominio_id
where h.reported_balance>=3
order by h.condominio_id,h.unidad_id
limit 1;

alter table recovery_test_scope add column current_fee_id uuid;

do $$ begin
  if (select count(*) from recovery_test_scope)<>1 or (select admin_id is null from recovery_test_scope) then
    raise exception 'TEST: falta cuenta histórica sintética o administrador DEV';
  end if;
end $$;

update public.condominium_operation_controls
set real_payments_enabled=true,current_billing_enabled=true
where condominio_id=(select condominio_id from recovery_test_scope);

with inserted as (
  insert into public.cuotas_condominio(condominio_id,unidad_id,periodo,monto,status,fecha_vencimiento)
  select condominio_id,unidad_id,'2099-12',500,'pendiente',date '2099-12-10'
  from recovery_test_scope
  returning id
)
update recovery_test_scope set current_fee_id=inserted.id from inserted;

grant select on recovery_test_scope to authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select admin_id from recovery_test_scope),'role','authenticated'
)::text,true);
set local role authenticated;

-- Dos pendientes pueden coexistir; ninguno reduce el saldo.
select public.condominium_create_historical_recovery(
  '81000000-0000-4000-8000-000000000001',condominio_id,unidad_id,historical_account_id,
  1,1,'DEV-HIST-ONE',now(),
  condominio_id::text||'/'||unidad_id::text||'/81000000-0000-4000-8000-000000000001.pdf',
  repeat('1',64),
  '82000000-0000-4000-8000-000000000001',null
) from recovery_test_scope;

select public.condominium_create_historical_recovery(
  '81000000-0000-4000-8000-000000000002',condominio_id,unidad_id,historical_account_id,
  reported_balance,reported_balance+500,'DEV-HIST-COMBINED',now(),
  condominio_id::text||'/'||unidad_id::text||'/81000000-0000-4000-8000-000000000002.pdf',
  repeat('2',64),
  '82000000-0000-4000-8000-000000000002',current_fee_id
) from recovery_test_scope;

do $$
declare duplicate_blocked boolean:=false; scope recovery_test_scope%rowtype;
begin
  select * into scope from recovery_test_scope;
  begin
    perform public.condominium_create_historical_recovery(
      '81000000-0000-4000-8000-000000000003',scope.condominio_id,scope.unidad_id,scope.historical_account_id,
      1,1,'DEV-HIST-DUPLICATE-PROOF',now(),
      scope.condominio_id::text||'/'||scope.unidad_id::text||'/81000000-0000-4000-8000-000000000003.pdf',
      repeat('1',64),'82000000-0000-4000-8000-000000000003',null
    );
  exception when unique_violation then duplicate_blocked:=true;
  end;
  if not duplicate_blocked then raise exception 'TEST: comprobante duplicado fue aceptado'; end if;
end $$;

do $$ begin
  if (select count(*) from public.condominium_historical_recoveries where id in (
    '81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002'
  ) and status='PENDIENTE_APLICACION')<>2 then
    raise exception 'TEST: pendientes no fueron creados correctamente';
  end if;
end $$;

select public.condominium_apply_historical_recovery(
  '81000000-0000-4000-8000-000000000001',date '2099-12-01','MAYRANI-DEV-ONE'
);

do $$ begin
  if coalesce((select current_collected from public.condominium_current_collection_kpis
    where condominio_id=(select condominio_id from recovery_test_scope) and periodo='2099-12'),0)<>0 then
    raise exception 'TEST: recuperación histórica incrementó KPI corriente';
  end if;
end $$;

do $$
declare failed boolean:=false;
begin
  begin
    perform public.condominium_apply_historical_recovery(
      '81000000-0000-4000-8000-000000000002',date '2099-12-01','MAYRANI-DEV-TWO'
    );
  exception when check_violation then failed:=true;
  end;
  if not failed then raise exception 'TEST: el sobrepago concurrente no fue rechazado'; end if;
  if (select status from public.cuotas_condominio where id=(select current_fee_id from recovery_test_scope))<>'pendiente' then
    raise exception 'TEST: falló el rollback atómico de la cuota combinada';
  end if;
  if (select status from public.condominium_historical_recoveries where id='81000000-0000-4000-8000-000000000002')<>'PENDIENTE_APLICACION' then
    raise exception 'TEST: falló el rollback atómico de la recuperación';
  end if;
end $$;

select public.condominium_reverse_historical_recovery(
  '81000000-0000-4000-8000-000000000001','Reversión sintética controlada DEV'
);

do $$ begin
  if (select status from public.condominium_historical_recoveries where id='81000000-0000-4000-8000-000000000001')<>'REVERSADO' then
    raise exception 'TEST: la reversión no restauró el saldo';
  end if;
end $$;

-- Con saldo restaurado, la conciliación combinada aplica cuota completa + histórico.
select public.condominium_apply_historical_recovery(
  '81000000-0000-4000-8000-000000000002',date '2099-12-02','MAYRANI-DEV-COMBINED'
);

do $$ begin
  if (select status from public.cuotas_condominio where id=(select current_fee_id from recovery_test_scope))<>'pagado' then
    raise exception 'TEST: cuota completa combinada no fue aplicada';
  end if;
  if (select status from public.condominium_historical_recoveries where id='81000000-0000-4000-8000-000000000002')<>'APLICADO' then
    raise exception 'TEST: recuperación combinada no fue aplicada';
  end if;
  if coalesce((select current_collected from public.condominium_current_collection_kpis
    where condominio_id=(select condominio_id from recovery_test_scope) and periodo='2099-12'),0)<>500 then
    raise exception 'TEST: KPI corriente no refleja únicamente la cuota completa';
  end if;
end $$;

-- RLS: un propietario/usuario sin permiso no puede leer ni ejecutar funciones.
reset role;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','ffffffff-ffff-4fff-8fff-fffffffff101','role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare denied boolean:=false;
begin
  begin
    perform public.condominium_reverse_historical_recovery(
      '81000000-0000-4000-8000-000000000001','Intento sin autorización'
    );
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'TEST: identidad externa operó una recuperación'; end if;
end $$;

rollback;
