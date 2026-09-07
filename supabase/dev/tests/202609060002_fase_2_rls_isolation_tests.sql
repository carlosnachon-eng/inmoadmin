\set ON_ERROR_STOP on
\pset pager off

-- IDs del clon DEV sanitizado, verificados durante el preflight de Fase 1.
\set carlos_id '28e979dd-dae5-416a-a948-fff1c39f22bb'
\set guillermo_id 'a92f8c7c-ed4f-427e-91b7-f1e261c763d3'
\set cinthia_id '62d8ab6c-1de9-4059-b784-8172c6b444fa'

begin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub', :'guillermo_id', true);
select 'GUILLERMO_DIRECTORY' test,
       count(*) total,
       count(*) filter (where team_code='VENTAS_PUEBLA') puebla,
       count(*) filter (where team_code='VENTAS_VERACRUZ') veracruz
from public.v_sales_team_directory;
select 'GUILLERMO_KPI_ALL' test,plaza_code,team_code,sum(citas_agendadas) citas,
       sum(apartados) apartados,sum(cierres) cierres,sum(ingresos) ingresos
from public.get_sales_kpis_by_scope('2026-09-01','2026-09-30',null,null)
group by plaza_code,team_code order by plaza_code;
select 'GUILLERMO_VERACRUZ_FORBIDDEN' test,count(*) rows_visible
from public.get_sales_kpis_by_scope('2026-09-01','2026-09-30',null,'VENTAS_VERACRUZ');
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub', :'cinthia_id', true);
select 'CINTHIA_DIRECTORY' test,
       count(*) total,
       count(*) filter (where team_code='VENTAS_PUEBLA') puebla,
       count(*) filter (where team_code='VENTAS_VERACRUZ') veracruz
from public.v_sales_team_directory;
select 'CINTHIA_KPI_ALL' test,plaza_code,team_code,sum(citas_agendadas) citas,
       sum(apartados) apartados,sum(cierres) cierres,sum(ingresos) ingresos
from public.get_sales_kpis_by_scope('2026-09-01','2026-09-30',null,null)
group by plaza_code,team_code order by plaza_code;
select 'CINTHIA_PUEBLA_FORBIDDEN' test,count(*) rows_visible
from public.get_sales_kpis_by_scope('2026-09-01','2026-09-30',null,'VENTAS_PUEBLA');
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub', :'carlos_id', true);
select 'CARLOS_DIRECTORY' test,
       count(*) total,
       count(*) filter (where team_code='VENTAS_PUEBLA') puebla,
       count(*) filter (where team_code='VENTAS_VERACRUZ') veracruz
from public.v_sales_team_directory;
select 'CARLOS_KPI_ALL' test,plaza_code,team_code,sum(citas_agendadas) citas,
       sum(apartados) apartados,sum(cierres) cierres,sum(ingresos) ingresos
from public.get_sales_kpis_by_scope('2026-09-01','2026-09-30',null,null)
group by plaza_code,team_code order by plaza_code;
rollback;

set role postgres;
select 'DIRECT_EXECUTE_LOCKED' test,
       has_function_privilege('authenticated',
         'public.attribute_commercial_event(text,text,uuid)', 'EXECUTE') authenticated_can_execute;
