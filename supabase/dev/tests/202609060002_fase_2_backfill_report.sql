\set ON_ERROR_STOP on
\pset pager off

-- El rollback de esta transacción garantiza que el ensayo del reporte no escribe backfill.
begin;
set local role postgres;
alter table public.commercial_attributions disable trigger trg_commercial_attributions_immutable;
truncate table public.commercial_attributions, public.commercial_attribution_attempts;

with report as (
  select * from public.report_commercial_attribution_backfill('2026-09-01','2026-09-30')
), classes(classification) as (
  values ('ATTRIBUTABLE'::text),('AMBIGUOUS'),('INCOMPLETE'),('EXCLUDED')
)
select c.classification,count(r.*) total
from classes c left join report r using(classification)
group by c.classification order by c.classification;

select event_type,event_key,event_date,classification,reason
from public.report_commercial_attribution_backfill('2026-09-01','2026-09-30')
order by event_date,event_type,event_key;
rollback;
