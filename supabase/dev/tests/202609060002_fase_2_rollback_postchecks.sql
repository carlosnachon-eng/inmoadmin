\set ON_ERROR_STOP on
\pset pager off
set role postgres;

select 'FASE1_TABLES_REMAIN' test,
  to_regclass('public.commercial_plazas') is not null plazas,
  to_regclass('public.sales_teams') is not null teams,
  to_regclass('public.commercial_attributions') is not null attributions;
select 'FASE2_OBJECTS_REMOVED' test,
  to_regclass('public.commercial_attribution_attempts') is null attempts_removed,
  to_regclass('public.v_commercial_kpi_events') is null kpi_view_removed,
  to_regclass('public.v_sales_team_directory') is null directory_removed,
  to_regprocedure('public.attribute_commercial_event(text,text,uuid)') is null attribution_function_removed,
  to_regprocedure('public.get_sales_kpis_by_scope(date,date,text,text)') is null kpi_function_removed;
select 'FASE2_COLUMN_REMOVED' test,not exists(
  select 1 from information_schema.columns
  where table_schema='public' and table_name='kpis_diarios' and column_name='advisor_profile_id'
) removed;
select 'SOURCE_ROWS_UNCHANGED' test,
  (select count(*) from public.citas) citas,
  (select count(*) from public.recibos_apartado) apartados,
  (select count(*) from public.cierres) cierres;
select 'FASE2_ATTRIBUTIONS_REMOVED' test,count(*) remaining
from public.commercial_attributions where source like 'fase2:auto:%';
select 'CINTHIA_TEMPORARY_FLAG_RESTORED' test,participa_kpis
from public.profiles where id='62d8ab6c-1de9-4059-b784-8172c6b444fa';
