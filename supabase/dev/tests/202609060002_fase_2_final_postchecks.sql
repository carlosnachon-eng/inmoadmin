\set ON_ERROR_STOP on
\pset pager off
set role postgres;

select 'INSTALLATION_OBJECTS' test,
  to_regclass('public.commercial_attribution_attempts') is not null attempts,
  to_regclass('public.v_commercial_kpi_events') is not null kpi_view,
  to_regclass('public.v_sales_team_directory') is not null directory,
  to_regprocedure('public.attribute_commercial_event(text,text,uuid)') is not null attribution_function,
  to_regprocedure('public.get_sales_kpis_by_scope(date,date,text,text)') is not null kpi_function;
select 'SOURCE_TRIGGERS' test,count(*) installed
from pg_trigger where not tgisinternal and tgname in(
  'trg_commercial_attribution_citas','trg_commercial_attribution_apartados',
  'trg_commercial_attribution_cierres','trg_commercial_attributions_immutable'
);
select 'ATTRIBUTIONS' test,count(*) total,
  count(*) filter(where cita_id is not null) citas,
  count(*) filter(where recibo_apartado_id is not null) apartados,
  count(*) filter(where cierre_id is not null) cierres
from public.commercial_attributions where source like 'fase2:auto:%';
select 'AUDIT_OUTCOMES' test,outcome,count(*) total
from public.commercial_attribution_attempts group by outcome order by outcome;
select 'PLAZA_PROPERTIES' test,p.code,count(pr.*) properties
from public.commercial_plazas p left join public.propiedades pr on pr.plaza_id=p.id
group by p.code order by p.code;
select 'ACTIVE_TEAMS' test,t.code,p.code plaza,count(m.*) memberships
from public.sales_teams t join public.commercial_plazas p on p.id=t.plaza_id
left join public.sales_team_memberships m on m.team_id=t.id and m.left_at is null
where t.active group by t.code,p.code order by t.code;
select 'RESPONSIBILITIES' test,t.code,p.email,r.starts_at,r.ends_at
from public.sales_team_responsibilities r join public.sales_teams t on t.id=r.team_id
join public.profiles p on p.id=r.responsible_profile_id
order by t.code,r.starts_at;
select 'CINTHIA_FINAL_DEV' test,p.email,p.participa_kpis,d.team_code,d.plaza_code
from public.profiles p join public.v_sales_team_directory d on d.advisor_profile_id=p.id
where p.id='62d8ab6c-1de9-4059-b784-8172c6b444fa';
select 'PROTECTED_EXECUTION' test,
  has_function_privilege('authenticated','public.attribute_commercial_event(text,text,uuid)','EXECUTE') authenticated_direct,
  has_function_privilege('service_role','public.attribute_commercial_event(text,text,uuid)','EXECUTE') service_role_direct;
