\set ON_ERROR_STOP on
\pset pager off

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

select 'PROTECTED_EXECUTION' test,
  has_function_privilege('authenticated','public.attribute_commercial_event(text,text,uuid)','EXECUTE') authenticated_direct,
  has_function_privilege('service_role','public.attribute_commercial_event(text,text,uuid)','EXECUTE') service_role_direct;

select 'CINTHIA_PRE_ACTIVATION' test,email,participa_kpis
from public.profiles where id='62d8ab6c-1de9-4059-b784-8172c6b444fa';

select outcome,count(*) from public.commercial_attribution_attempts group by outcome order by outcome;
select count(*) attributions from public.commercial_attributions where source like 'fase2:auto:%';

-- Ejecutar los bloques de impersonación del archivo de pruebas RLS antes de activar a Cinthia.
