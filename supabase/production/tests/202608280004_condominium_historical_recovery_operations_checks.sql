-- Postcheck inicial de sólo lectura. Ejecutar antes de registrar recuperaciones reales.
do $$
declare
  genova_id constant uuid:='29ebc26e-b82d-c90c-10a7-1f3761aeca09';
  units_count bigint;
  historical record;
  historical_payments record;
  september record;
  recoveries_count bigint;
  evidence_count bigint;
begin
  if to_regprocedure('public.condominium_create_historical_recovery(uuid,uuid,uuid,uuid,numeric,numeric,text,timestamp with time zone,text,text,uuid,uuid)') is null
     or to_regprocedure('public.condominium_apply_historical_recovery(uuid,date,text)') is null
     or to_regprocedure('public.condominium_reverse_historical_recovery(uuid,text)') is null then
    raise exception 'POSTCHECK: faltan funciones de recuperación histórica';
  end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='condominium_historical_recoveries'
      and column_name='idempotency_key' and is_nullable='NO'
  ) then raise exception 'POSTCHECK: contrato de idempotencia incompleto'; end if;
  if (select public from storage.buckets where id='condominium-historical-evidence') is distinct from false then
    raise exception 'POSTCHECK: evidencia histórica no está en bucket privado';
  end if;
  select count(*) into evidence_count
  from storage.objects
  where bucket_id='condominium-historical-evidence'
    and name like genova_id::text||'/%';
  if evidence_count<>0 then
    raise exception 'POSTCHECK: aparecieron evidencias antes de iniciar operación';
  end if;
  select count(*) into recoveries_count
  from public.condominium_historical_recoveries
  where condominio_id=genova_id;
  if recoveries_count<>0 then
    raise exception 'POSTCHECK: aparecieron recuperaciones antes de iniciar operación';
  end if;
  if exists(
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name='condominium_historical_recoveries'
      and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')
  ) then raise exception 'POSTCHECK: DML directo abierto a cliente'; end if;

  select count(*) into units_count
  from public.unidades_condominio
  where condominio_id=genova_id;
  if units_count<>24 then
    raise exception 'POSTCHECK: cambió el padrón de unidades de Génova';
  end if;

  select count(*) accounts,coalesce(sum(reported_charges),0) charges,
    coalesce(sum(reported_payments),0) payments,coalesce(sum(reported_balance),0) balance
  into historical from public.condominium_historical_accounts
  where condominio_id=genova_id;
  if historical.accounts<>24 or historical.charges<>107000 or historical.payments<>23500 or historical.balance<>83500 then
    raise exception 'POSTCHECK: cambió la cartera histórica base';
  end if;

  select count(*) payments,coalesce(sum(reported_amount),0) amount
  into historical_payments from public.condominium_historical_payments
  where condominio_id=genova_id;
  if historical_payments.payments<>41 or historical_payments.amount<>23500 then
    raise exception 'POSTCHECK: cambiaron los pagos históricos Antive';
  end if;

  select count(*) fees,coalesce(sum(monto),0) amount into september
  from public.cuotas_condominio
  where condominio_id=genova_id and periodo='2026-09';
  if september.fees<>23 or september.amount<>11500 then
    raise exception 'POSTCHECK: cambió la cobranza corriente de septiembre';
  end if;
end $$;

with genova as (
  select '29ebc26e-b82d-c90c-10a7-1f3761aeca09'::uuid as id
)
select jsonb_build_object(
  'status','OK',
  'condominium_id',(select id from genova),
  'units',(select count(*) from public.unidades_condominio where condominio_id=(select id from genova)),
  'recoveries',(select count(*) from public.condominium_historical_recoveries where condominio_id=(select id from genova)),
  'historical_balance',(select coalesce(sum(reported_balance),0) from public.condominium_historical_accounts where condominio_id=(select id from genova)),
  'september_fees',(select count(*) from public.cuotas_condominio where condominio_id=(select id from genova) and periodo='2026-09'),
  'september_amount',(select coalesce(sum(monto),0) from public.cuotas_condominio where condominio_id=(select id from genova) and periodo='2026-09'),
  'evidence_bucket','PRIVATE_EMPTY'
) as condominium_historical_recovery_postcheck;
