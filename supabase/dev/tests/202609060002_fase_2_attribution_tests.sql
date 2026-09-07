\pset tuples_only on
\pset format unaligned

set role postgres;
truncate public.commercial_attribution_attempts,public.commercial_attributions;

select 'first_cita_puebla',public.attribute_commercial_event('CITA','20000000-0000-4000-8000-000000000001',null)->>'status';
select 'first_cita_veracruz',public.attribute_commercial_event('CITA','20000000-0000-4000-8000-000000000002',null)->>'status';
select 'first_apartado_puebla',public.attribute_commercial_event('APARTADO','30000000-0000-4000-8000-000000000001',null)->>'status';
select 'first_apartado_veracruz',public.attribute_commercial_event('APARTADO','30000000-0000-4000-8000-000000000002',null)->>'status';
select 'first_cierre_puebla',public.attribute_commercial_event('CIERRE','1001',null)->>'status';
select 'first_cierre_veracruz',public.attribute_commercial_event('CIERRE','1002',null)->>'status';

select 'retry_cita',public.attribute_commercial_event('CITA','20000000-0000-4000-8000-000000000001',null)->>'status';
select 'retry_apartado',public.attribute_commercial_event('APARTADO','30000000-0000-4000-8000-000000000001',null)->>'status';
select 'retry_cierre',public.attribute_commercial_event('CIERRE','1001',null)->>'status';
select 'invalid_key',public.attribute_commercial_event('CIERRE','not-a-number',null)->>'status';

select 'attribution_counts',count(*),count(distinct cita_id),count(distinct recibo_apartado_id),count(distinct cierre_id)
from public.commercial_attributions;
select 'attempt_outcomes',outcome,count(*) from public.commercial_attribution_attempts group by outcome order by outcome;

-- Una cita valida pero incompleta debe sobrevivir; el trigger solo diagnostica.
begin;
insert into public.citas(id,cliente_id,propiedad_id,asesor_id,fecha_hora,estado,notas)
values('40000000-0000-4000-8000-000000000001',null,null,'62d8ab6c-1de9-4059-b784-8172c6b444fa',
       '2026-09-06 10:00:00-06','agendada','Prueba pendiente de atribucion');
select 'original_survives_pending',count(*) from public.citas where id='40000000-0000-4000-8000-000000000001';
select 'pending_diagnostic',outcome,reason from public.commercial_attribution_attempts
where event_key='40000000-0000-4000-8000-000000000001' order by attempted_at desc limit 1;
rollback;

-- El gerente responsable puede originar una operación de su propia plaza aunque
-- no tenga una membresía duplicada como asesor.
begin;
insert into public.citas(id,cliente_id,propiedad_id,asesor_id,fecha_hora,estado,notas)
select '40000000-0000-4000-8000-000000000002',null,c.propiedad_id,
       'a92f8c7c-ed4f-427e-91b7-f1e261c763d3','2026-09-06 11:00:00-06','efectiva',
       'Prueba atribucion gerente responsable'
from public.citas c where c.id='20000000-0000-4000-8000-000000000001';
select 'manager_event_attributed',outcome,reason from public.commercial_attribution_attempts
where event_key='40000000-0000-4000-8000-000000000002' order by attempted_at desc limit 1;
rollback;

-- Snapshot inmutable; el error se captura y toda la prueba se revierte.
do $$
declare v_rows integer;
begin
  begin
    update public.commercial_attributions set source='mutated' where cierre_id=1002;
    get diagnostics v_rows=row_count;
    if v_rows>0 then raise exception 'IMMUTABILITY_NOT_ENFORCED'; end if;
  exception when others then
    if sqlerrm='IMMUTABILITY_NOT_ENFORCED' then raise; end if;
    raise notice 'IMMUTABILITY_BLOCKED_OK: %',sqlerrm;
  end;
end $$;

select set_config('request.jwt.claim.role','service_role',false);
select 'kpi_puebla',plaza_code,team_code,sum(citas_agendadas),sum(apartados),sum(cierres),sum(ingresos)
from public.get_sales_kpis_by_scope('2026-09-01','2026-09-30','PUEBLA',null)
group by plaza_code,team_code;
select 'kpi_veracruz',plaza_code,team_code,sum(citas_agendadas),sum(apartados),sum(cierres),sum(ingresos)
from public.get_sales_kpis_by_scope('2026-09-01','2026-09-30','VERACRUZ',null)
group by plaza_code,team_code;

select 'backfill_report',classification,count(*)
from public.report_commercial_attribution_backfill('2026-09-01','2026-09-30')
group by classification order by classification;
