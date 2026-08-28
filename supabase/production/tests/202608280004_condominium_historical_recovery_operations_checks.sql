-- Postcheck inicial de sólo lectura. Ejecutar antes de registrar recuperaciones reales.
do $$
declare
  historical record;
  september record;
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
  if exists(select 1 from storage.objects where bucket_id='condominium-historical-evidence') then
    raise exception 'POSTCHECK: aparecieron evidencias antes de iniciar operación';
  end if;
  if exists(select 1 from public.condominium_historical_recoveries) then
    raise exception 'POSTCHECK: aparecieron recuperaciones antes de iniciar operación';
  end if;
  if exists(
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name='condominium_historical_recoveries'
      and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')
  ) then raise exception 'POSTCHECK: DML directo abierto a cliente'; end if;

  select count(*) accounts,coalesce(sum(reported_charges),0) charges,
    coalesce(sum(reported_payments),0) payments,coalesce(sum(reported_balance),0) balance
  into historical from public.condominium_historical_accounts;
  if historical.accounts<>24 or historical.charges<>107000 or historical.payments<>23500 or historical.balance<>83500 then
    raise exception 'POSTCHECK: cambió la cartera histórica base';
  end if;

  select count(*) fees,coalesce(sum(monto),0) amount into september
  from public.cuotas_condominio where periodo='2026-09';
  if september.fees<>23 or september.amount<>11500 then
    raise exception 'POSTCHECK: cambió la cobranza corriente de septiembre';
  end if;
end $$;

select jsonb_build_object(
  'status','OK',
  'recoveries',0,
  'historical_balance',83500,
  'september_fees',23,
  'september_amount',11500,
  'evidence_bucket','PRIVATE_EMPTY'
) as condominium_historical_recovery_postcheck;
