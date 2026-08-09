-- Fase 2A preflight - solo lectura.
-- Ejecutar antes de aplicar 202608080007_fase_2a_production_hardening.sql.
-- No modifica datos ni estructura.

with required_tables(table_name) as (
  values
    ('profiles'),
    ('clientes'),
    ('propiedades'),
    ('citas'),
    ('cierres'),
    ('seguimientos_cliente')
)
select
  'missing_required_tables' as check_name,
  jsonb_agg(table_name order by table_name) filter (where c.relname is null) as details
from required_tables rt
left join pg_class c
  on c.relname = rt.table_name
 and c.relnamespace = 'public'::regnamespace
where c.relname is null;

select
  'required_roles' as check_name,
  jsonb_agg(role_name order by role_name) filter (where r.rolname is null) as details
from (values ('anon'), ('authenticated'), ('service_role')) expected(role_name)
left join pg_roles r on r.rolname = expected.role_name
where r.rolname is null;

select
  'extensions' as check_name,
  jsonb_agg(name order by name) filter (where e.extname is null) as details
from (values ('pgcrypto')) expected(name)
left join pg_extension e on e.extname = expected.name
where e.extname is null;

select
  'duplicate_active_interventions' as check_name,
  advisor_profile_id,
  scope,
  indicators->>'contextKey' as context_key,
  count(*) as duplicate_count,
  jsonb_agg(id order by created_at) as ids
from public.gv_management_interventions
where to_regclass('public.gv_management_interventions') is not null
  and status in ('pendiente', 'en_seguimiento', 'sin_mejora')
  and indicators ? 'contextKey'
group by advisor_profile_id, scope, indicators->>'contextKey'
having count(*) > 1;

select
  'blank_intervention_context_key' as check_name,
  id,
  advisor_profile_id,
  scope,
  status
from public.gv_management_interventions
where to_regclass('public.gv_management_interventions') is not null
  and indicators ? 'contextKey'
  and length(trim(indicators->>'contextKey')) = 0;

select
  'overlapping_availability_periods' as check_name,
  a.profile_id,
  a.id as first_id,
  b.id as second_id,
  a.starts_on as first_starts_on,
  a.ends_on as first_ends_on,
  b.starts_on as second_starts_on,
  b.ends_on as second_ends_on
from public.gv_advisor_availability a
join public.gv_advisor_availability b
  on a.profile_id = b.profile_id
 and a.id < b.id
 and daterange(a.starts_on, coalesce(a.ends_on, 'infinity'::date), '[]')
     && daterange(b.starts_on, coalesce(b.ends_on, 'infinity'::date), '[]')
where to_regclass('public.gv_advisor_availability') is not null;

select
  'fk_type_check' as check_name,
  table_name,
  column_name,
  data_type,
  udt_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'profiles' and column_name = 'id')
    or (table_name = 'cierres' and column_name = 'advisor_profile_id')
    or (table_name = 'citas' and column_name in ('asesor_id', 'confirmacion_actualizada_por'))
    or (table_name = 'gv_opportunities' and column_name = 'asesor_id')
    or (table_name = 'gv_management_interventions' and column_name in ('advisor_profile_id', 'actor_profile_id'))
  )
order by table_name, column_name;
