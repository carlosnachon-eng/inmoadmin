\pset tuples_only on
\pset format unaligned
set role postgres;
select set_config('request.jwt.claim.role','service_role',false);

-- Reproduce el alcance del dashboard vigente: consultas globales del periodo,
-- sin filtro por plaza/equipo. En la UI ese total se interpreta como Puebla.
with current_global as (
  select
    (select count(*) from public.citas where fecha_hora>='2026-09-01' and fecha_hora<'2026-10-01') citas,
    (select count(*) from public.citas where fecha_hora>='2026-09-01' and fecha_hora<'2026-10-01' and estado in ('efectiva','calificada')) efectivas,
    (select count(*) from public.cierres where fecha_cierre between '2026-09-01' and '2026-09-30') cierres,
    (select coalesce(sum(comision),0) from public.cierres where fecha_cierre between '2026-09-01' and '2026-09-30') ingresos
), attributed_puebla as (
  select coalesce(sum(citas_agendadas),0) citas,coalesce(sum(citas_efectivas),0) efectivas,
         coalesce(sum(cierres),0) cierres,coalesce(sum(ingresos),0) ingresos
  from public.get_sales_kpis_by_scope('2026-09-01','2026-09-30','PUEBLA',null)
)
select 'CURRENT_GLOBAL_LABELED_PUEBLA',citas,efectivas,cierres,ingresos from current_global
union all
select 'NEW_ATTRIBUTED_PUEBLA',citas,efectivas,cierres,ingresos from attributed_puebla;

select 'EXPLANATION_VERACRUZ_EXCLUDED',
  coalesce(sum(citas_agendadas),0),coalesce(sum(citas_efectivas),0),coalesce(sum(cierres),0),coalesce(sum(ingresos),0)
from public.get_sales_kpis_by_scope('2026-09-01','2026-09-30','VERACRUZ',null);
