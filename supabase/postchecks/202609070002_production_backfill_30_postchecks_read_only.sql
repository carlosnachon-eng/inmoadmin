\set ON_ERROR_STOP on
\pset pager off

select now() checked_at,current_database();

-- Persistencia, distribución y trazabilidad del lote autorizado.
select 'AUTHORIZED_BATCH' check_name,
  count(*) total,
  count(*) filter(where cita_id is not null) citas,
  count(*) filter(where recibo_apartado_id is not null) apartados,
  count(*) filter(where cierre_id is not null) cierres,
  count(*) filter(where source='fase2:backfill:20260907:strong-structured-evidence') exact_source
from public.commercial_attributions
where source='fase2:backfill:20260907:strong-structured-evidence';

select 'DUPLICATES' check_name,count(*) duplicate_groups
from (
  select coalesce(cita_id::text,recibo_apartado_id::text,cierre_id::text),count(*)
  from public.commercial_attributions
  where cita_id is not null or recibo_apartado_id is not null or cierre_id is not null
  group by 1 having count(*)>1
) d;

select 'ATTRIBUTIONS_BY_SCOPE' check_name,p.code plaza,t.code team,
  count(*) total,
  count(*) filter(where a.cita_id is not null) citas,
  count(*) filter(where a.recibo_apartado_id is not null) apartados,
  count(*) filter(where a.cierre_id is not null) cierres
from public.commercial_attributions a
join public.commercial_plazas p on p.id=a.plaza_id
join public.sales_teams t on t.id=a.team_id
where a.source='fase2:backfill:20260907:strong-structured-evidence'
group by p.code,t.code order by p.code,t.code;

-- Los 14 excluidos permanecen sin atribución y sin propiedad.
with pending as (
  select 'CITA' event_type,c.id::text event_id,c.fecha_hora occurred_at
  from public.citas c left join public.commercial_attributions a on a.cita_id=c.id
  where c.fecha_hora>='2026-09-01' and c.propiedad_id is null and a.id is null
  union all
  select 'APARTADO',r.id::text,coalesce(r.created_at,r.fecha::timestamp)
  from public.recibos_apartado r left join public.commercial_attributions a on a.recibo_apartado_id=r.id
  where coalesce(r.created_at,r.fecha::timestamp)>='2026-09-01' and r.propiedad_id is null and a.id is null
  union all
  select 'CIERRE',c.id::text,c.fecha_cierre::timestamp
  from public.cierres c left join public.commercial_attributions a on a.cierre_id=c.id
  where c.fecha_cierre>='2026-09-01' and c.propiedad_id is null and a.id is null
)
select 'PENDING_MISSING_PROPERTY' check_name,event_type,count(*) pending
from pending group by event_type
union all select 'PENDING_MISSING_PROPERTY','TOTAL',count(*) from pending
order by event_type;

-- Guardia de activación: Cinthia debe seguir fuera de KPI en Producción.
select 'CINTHIA_STILL_PROTECTED' check_name,email,participa_kpis
from public.profiles where id='62d8ab6c-1de9-4059-b784-8172c6b444fa';

-- Fase 2 de esquema/código sigue sin instalarse.
select 'FASE2_DEPLOYMENT_STILL_ABSENT' check_name,
  to_regclass('public.commercial_attribution_attempts') is null attempts_absent,
  to_regclass('public.v_commercial_kpi_events') is null kpi_view_absent,
  to_regprocedure('public.attribute_commercial_event(text,text,uuid)') is null function_absent;

-- Comparación reproducible para septiembre de 2026.
with legacy as (
  select
    (select count(*) from public.citas where fecha_hora>='2026-09-01 00:00:00 America/Mexico_City' and fecha_hora<'2026-10-01 00:00:00 America/Mexico_City') citas,
    (select count(*) from public.citas where fecha_hora>='2026-09-01 00:00:00 America/Mexico_City' and fecha_hora<'2026-10-01 00:00:00 America/Mexico_City' and estado in ('efectiva','calificada')) efectivas,
    (select count(*) from public.recibos_apartado where coalesce(created_at,fecha::timestamp)>='2026-09-01' and coalesce(created_at,fecha::timestamp)<'2026-10-01') apartados,
    (select count(*) from public.cierres where fecha_cierre>='2026-09-01' and fecha_cierre<'2026-10-01') cierres,
    (select coalesce(sum(comision),0) from public.cierres where fecha_cierre>='2026-09-01' and fecha_cierre<'2026-10-01') ingresos
), attributed as (
  select p.code plaza,
    count(*) filter(where a.cita_id is not null) citas,
    count(*) filter(where a.cita_id is not null and c.estado in ('efectiva','calificada')) efectivas,
    count(*) filter(where a.recibo_apartado_id is not null) apartados,
    count(*) filter(where a.cierre_id is not null) cierres,
    coalesce(sum(cl.comision) filter(where a.cierre_id is not null),0) ingresos
  from public.commercial_plazas p
  left join public.commercial_attributions a on a.plaza_id=p.id
    and a.occurred_at>='2026-09-01 00:00:00 America/Mexico_City'
    and a.occurred_at<'2026-10-01 00:00:00 America/Mexico_City'
  left join public.citas c on c.id=a.cita_id
  left join public.cierres cl on cl.id=a.cierre_id
  group by p.code
), consolidated as (
  select coalesce(sum(citas),0) citas,coalesce(sum(efectivas),0) efectivas,
    coalesce(sum(apartados),0) apartados,coalesce(sum(cierres),0) cierres,coalesce(sum(ingresos),0) ingresos
  from attributed
)
select 'LEGACY_GLOBAL' reading,citas,efectivas,apartados,cierres,ingresos from legacy
union all
select 'ATTRIBUTED_'||plaza,citas,efectivas,apartados,cierres,ingresos from attributed
union all
select 'ATTRIBUTED_CONSOLIDATED',citas,efectivas,apartados,cierres,ingresos from consolidated
order by reading;
