\set ON_ERROR_STOP on
\pset pager off

-- Ejecutar con rol de inspección. Este archivo contiene únicamente SELECT.
select now() checked_at,current_database();

select table_name
from information_schema.tables
where table_schema='public' and table_name in (
  'commercial_plazas','sales_teams','sales_team_memberships',
  'sales_team_responsibilities','commercial_attributions','citas',
  'recibos_apartado','cierres','kpis_diarios'
) order by table_name;

select 'FASE2_NOT_INSTALLED' check_name,
  to_regclass('public.commercial_attribution_attempts') is null attempts_absent,
  to_regclass('public.v_commercial_kpi_events') is null kpi_view_absent,
  to_regprocedure('public.attribute_commercial_event(text,text,uuid)') is null function_absent,
  not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='kpis_diarios' and column_name='advisor_profile_id') kpi_column_absent;

select table_name,column_name,data_type,udt_name,is_nullable
from information_schema.columns
where table_schema='public' and (
  (table_name='cierres' and column_name in ('id','propiedad_id','advisor_profile_id','recibo_id','fecha_cierre','comision')) or
  (table_name='citas' and column_name in ('id','propiedad_id','asesor_id','fecha_hora','estado')) or
  (table_name='recibos_apartado' and column_name in ('id','propiedad_id','asesor_id','fecha','created_at')) or
  (table_name='propiedades' and column_name in ('id','plaza_id')) or
  (table_name='profiles' and column_name in ('id','role_id','participa_kpis')) or
  (table_name='kpis_diarios' and column_name in ('id','email','fecha'))
) order by table_name,column_name;

select x.code plaza,t.code team,count(m.*) filter(where m.left_at is null) active_members
from public.commercial_plazas x join public.sales_teams t on t.plaza_id=x.id
left join public.sales_team_memberships m on m.team_id=t.id
group by x.code,t.code order by x.code;

select t.code team,p.email,r.starts_at,r.ends_at
from public.sales_team_responsibilities r join public.sales_teams t on t.id=r.team_id
join public.profiles p on p.id=r.responsible_profile_id
order by t.code,r.starts_at;

select p.id,p.email,p.role_id,p.active,p.participa_kpis
from public.profiles p where p.id in (
  '28e979dd-dae5-416a-a948-fff1c39f22bb',
  '62d8ab6c-1de9-4059-b784-8172c6b444fa',
  'a92f8c7c-ed4f-427e-91b7-f1e261c763d3'
) order by p.email;

select x.code,count(pr.*) properties
from public.commercial_plazas x left join public.propiedades pr on pr.plaza_id=x.id
group by x.code order by x.code;

select count(*) existing_attributions from public.commercial_attributions;
