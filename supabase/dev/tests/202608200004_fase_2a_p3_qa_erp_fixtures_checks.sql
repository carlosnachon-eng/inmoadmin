-- READ ONLY. Checks de fixtures ERP P3 v7 en inmoadmin-dev.
do $$ begin
  if not exists(select 1 from public.properties where id='f2a30000-0000-4000-8100-000000000001' and name='FASE2A-P3-QA Montpellier 101') then raise exception 'P3 QA property missing'; end if;
  if (select count(*) from public.properties where name ilike '%FASE2A-P3-QA Montpellier%') <> 2 then raise exception 'P3 QA ambiguity fixture mismatch'; end if;
  if not exists(select 1 from public.contracts where id='f2a30000-0000-4000-8200-000000000001' and property_id='f2a30000-0000-4000-8100-000000000001' and status in ('activo','active')) then raise exception 'P3 QA active contract missing'; end if;
  if not exists(select 1 from public.payments where id='f2a30000-0000-4000-8300-000000000001' and contract_id='f2a30000-0000-4000-8200-000000000001') then raise exception 'P3 QA payment missing'; end if;
  if not exists(select 1 from public.maintenance_tickets where id='f2a30000-0000-4000-8400-000000000001' and property_id='f2a30000-0000-4000-8100-000000000001') then raise exception 'P3 QA maintenance missing'; end if;
  if not exists(select 1 from public.pagos_servicios where id='f2a30000-0000-4000-8600-000000000001' and servicio_id='f2a30000-0000-4000-8500-000000000001') then raise exception 'P3 QA service period missing'; end if;
  if not exists(select 1 from public.pagos_servicios where id='f2a30000-0000-4000-8600-000000000002' and servicio_id='f2a30000-0000-4000-8500-000000000002' and tipo='cfe') then raise exception 'P3 QA CFE period missing'; end if;
  if not exists(select 1 from public.owner_payments where id='f2a30000-0000-4000-8700-000000000001') then raise exception 'P3 QA liquidation missing'; end if;
  if not exists(select 1 from public.llaves where id='f2a30000-0000-4000-8800-000000000001' and activa) then raise exception 'P3 QA key missing'; end if;
  if not exists(select 1 from public.administrative_case_controls where context_key='maintenance_ticket:f2a30000-0000-4000-8400-000000000001') then raise exception 'P3 QA work center case missing'; end if;
  if exists(select 1 from public.properties where name ilike '%FASE2A-P3-QA No Existe%') then raise exception 'P3 intentionally unresolved fixture must stay absent'; end if;
end $$;

select 'properties' object,count(*) actual,2 expected from public.properties where id in ('f2a30000-0000-4000-8100-000000000001','f2a30000-0000-4000-8100-000000000002')
union all select 'contracts',count(*),1 from public.contracts where id='f2a30000-0000-4000-8200-000000000001'
union all select 'payments',count(*),1 from public.payments where id='f2a30000-0000-4000-8300-000000000001'
union all select 'maintenance',count(*),1 from public.maintenance_tickets where id='f2a30000-0000-4000-8400-000000000001'
union all select 'service_periods',count(*),2 from public.pagos_servicios where id in ('f2a30000-0000-4000-8600-000000000001','f2a30000-0000-4000-8600-000000000002')
union all select 'owner_payment',count(*),1 from public.owner_payments where id='f2a30000-0000-4000-8700-000000000001'
union all select 'key',count(*),1 from public.llaves where id='f2a30000-0000-4000-8800-000000000001'
union all select 'work_center_case',count(*),1 from public.administrative_case_controls where context_key='maintenance_ticket:f2a30000-0000-4000-8400-000000000001';
