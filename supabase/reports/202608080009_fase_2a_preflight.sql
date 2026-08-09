-- Fase 2A preflight - solo lectura.
-- Ejecutar antes de aplicar 202608080007_fase_2a_production_hardening.sql.
-- No modifica datos ni estructura.
--
-- Salida:
--   check_name: nombre de la validacion.
--   status: OK, INFO o BLOCKER.
--   detail: resultado interpretable para SQL Editor.
--
-- Nota:
-- Las tablas gv_* son opcionales antes de la primera ejecucion de 007.
-- No se referencian directamente en FROM; las validaciones de datos usan SQL
-- dinamico mediante query_to_xml solo cuando la tabla existe.

with
required_tables(table_name) as (
  values
    ('profiles'),
    ('clientes'),
    ('propiedades'),
    ('citas'),
    ('cierres'),
    ('seguimientos_cliente')
),
optional_phase_2a_tables(table_name) as (
  values
    ('gv_supervision_edges'),
    ('gv_advisor_availability'),
    ('gv_opportunities'),
    ('gv_opportunity_events'),
    ('gv_respond_contact_snapshots'),
    ('gv_management_interventions')
),
required_roles(role_name) as (
  values ('anon'), ('authenticated'), ('service_role')
),
required_extensions(extension_name) as (
  values ('pgcrypto')
),
expected_columns(table_name, column_name, udt_name, required_before_007) as (
  values
    ('profiles', 'id', 'uuid', true),
    ('clientes', 'id', 'uuid', true),
    ('propiedades', 'id', 'uuid', true),
    ('citas', 'asesor_id', 'uuid', true),
    ('cierres', 'id', 'int8', true),
    ('citas', 'confirmacion_estado', 'text', false),
    ('citas', 'confirmacion_actualizada_at', 'timestamptz', false),
    ('citas', 'confirmacion_actualizada_por', 'uuid', false),
    ('cierres', 'advisor_profile_id', 'uuid', false),
    ('cierres', 'operation_type_structured', 'text', false),
    ('cierres', 'operation_type_confidence', 'text', false),
    ('cierres', 'operation_type_source', 'text', false),
    ('cierres', 'classified_by', 'uuid', false),
    ('cierres', 'classified_at', 'timestamptz', false),
    ('cierres', 'classification_notes', 'text', false),
    ('gv_supervision_edges', 'id', 'uuid', false),
    ('gv_supervision_edges', 'supervisor_profile_id', 'uuid', false),
    ('gv_supervision_edges', 'subordinate_profile_id', 'uuid', false),
    ('gv_supervision_edges', 'scope', 'text', false),
    ('gv_supervision_edges', 'starts_on', 'date', false),
    ('gv_supervision_edges', 'ends_on', 'date', false),
    ('gv_supervision_edges', 'active', 'bool', false),
    ('gv_advisor_availability', 'id', 'uuid', false),
    ('gv_advisor_availability', 'profile_id', 'uuid', false),
    ('gv_advisor_availability', 'starts_on', 'date', false),
    ('gv_advisor_availability', 'ends_on', 'date', false),
    ('gv_advisor_availability', 'status', 'text', false),
    ('gv_advisor_availability', 'capacity_weight', 'numeric', false),
    ('gv_advisor_availability', 'reason', 'text', false),
    ('gv_opportunities', 'id', 'uuid', false),
    ('gv_opportunities', 'cliente_id', 'uuid', false),
    ('gv_opportunities', 'propiedad_id', 'uuid', false),
    ('gv_opportunities', 'asesor_id', 'uuid', false),
    ('gv_opportunities', 'owner_profile_id', 'uuid', false),
    ('gv_opportunities', 'stage', 'text', false),
    ('gv_opportunities', 'operation_type', 'text', false),
    ('gv_opportunities', 'forecast_category', 'text', false),
    ('gv_opportunities', 'estimated_commission', 'numeric', false),
    ('gv_opportunities', 'next_action_at', 'timestamptz', false),
    ('gv_opportunities', 'risk_level', 'text', false),
    ('gv_opportunities', 'cierre_id', 'int8', false),
    ('gv_opportunities', 'respond_contact_id', 'text', false),
    ('gv_opportunities', 'respond_unanswered_since', 'timestamptz', false),
    ('gv_opportunity_events', 'id', 'uuid', false),
    ('gv_opportunity_events', 'opportunity_id', 'uuid', false),
    ('gv_opportunity_events', 'actor_profile_id', 'uuid', false),
    ('gv_opportunity_events', 'acted_as_profile_id', 'uuid', false),
    ('gv_opportunity_events', 'event_type', 'text', false),
    ('gv_respond_contact_snapshots', 'id', 'uuid', false),
    ('gv_respond_contact_snapshots', 'respond_contact_id', 'text', false),
    ('gv_respond_contact_snapshots', 'mapped_profile_id', 'uuid', false),
    ('gv_respond_contact_snapshots', 'mapping_status', 'text', false),
    ('gv_respond_contact_snapshots', 'respond_conversation_status', 'text', false),
    ('gv_respond_contact_snapshots', 'respond_unanswered_since', 'timestamptz', false),
    ('gv_respond_contact_snapshots', 'atn_area', 'text', false),
    ('gv_management_interventions', 'id', 'uuid', false),
    ('gv_management_interventions', 'advisor_profile_id', 'uuid', false),
    ('gv_management_interventions', 'actor_profile_id', 'uuid', false),
    ('gv_management_interventions', 'scope', 'text', false),
    ('gv_management_interventions', 'reason', 'text', false),
    ('gv_management_interventions', 'agreed_action', 'text', false),
    ('gv_management_interventions', 'status', 'text', false),
    ('gv_management_interventions', 'indicators', 'jsonb', false)
),
column_checks as (
  select
    ec.table_name,
    ec.column_name,
    ec.udt_name as expected_udt_name,
    ec.required_before_007,
    c.udt_name as actual_udt_name,
    to_regclass(format('public.%I', ec.table_name)) is not null as table_exists
  from expected_columns ec
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = ec.table_name
   and c.column_name = ec.column_name
),
critical_fk_targets(schema_name, table_name, column_name, udt_name) as (
  values
    ('public', 'profiles', 'id', 'uuid'),
    ('public', 'clientes', 'id', 'uuid'),
    ('public', 'propiedades', 'id', 'uuid'),
    ('public', 'cierres', 'id', 'int8'),
    ('auth', 'users', 'id', 'uuid')
),
critical_fk_target_checks as (
  select
    cft.schema_name,
    cft.table_name,
    cft.column_name,
    cft.udt_name as expected_udt_name,
    c.udt_name as actual_udt_name,
    to_regclass(format('%I.%I', cft.schema_name, cft.table_name)) is not null as table_exists
  from critical_fk_targets cft
  left join information_schema.columns c
    on c.table_schema = cft.schema_name
   and c.table_name = cft.table_name
   and c.column_name = cft.column_name
),
critical_fk_target_issues as (
  select jsonb_agg(
    schema_name || '.' || table_name || '.' || column_name || ': esperado ' || expected_udt_name || ', actual ' || coalesce(actual_udt_name, 'missing')
    order by schema_name, table_name, column_name
  ) as issues
  from critical_fk_target_checks
  where table_exists = false
    or actual_udt_name is null
    or actual_udt_name <> expected_udt_name
),
missing_required_tables as (
  select jsonb_agg(rt.table_name order by rt.table_name) as missing
  from required_tables rt
  where to_regclass(format('public.%I', rt.table_name)) is null
),
missing_roles as (
  select jsonb_agg(rr.role_name order by rr.role_name) as missing
  from required_roles rr
  where not exists (select 1 from pg_roles r where r.rolname = rr.role_name)
),
missing_extensions as (
  select jsonb_agg(re.extension_name order by re.extension_name) as missing
  from required_extensions re
  where not exists (select 1 from pg_extension e where e.extname = re.extension_name)
),
optional_table_status as (
  select
    'phase_2a_table:' || table_name as check_name,
    case
      when to_regclass(format('public.%I', table_name)) is null then 'INFO'
      else 'OK'
    end as status,
    case
      when to_regclass(format('public.%I', table_name)) is null
        then 'No existe todavia; esperado antes de 007.'
      else 'Existe; se validan columnas y datos aplicables.'
    end as detail
  from optional_phase_2a_tables
),
missing_required_columns as (
  select jsonb_agg(table_name || '.' || column_name order by table_name, column_name) as missing
  from column_checks
  where required_before_007 = true
    and table_exists = true
    and actual_udt_name is null
),
missing_optional_columns as (
  select jsonb_agg(table_name || '.' || column_name order by table_name, column_name) as missing
  from column_checks
  where required_before_007 = false
    and table_exists = true
    and table_name in (select table_name from optional_phase_2a_tables)
    and actual_udt_name is null
),
missing_base_phase_2a_columns as (
  select jsonb_agg(table_name || '.' || column_name order by table_name, column_name) as missing
  from column_checks
  where required_before_007 = false
    and table_exists = true
    and table_name not in (select table_name from optional_phase_2a_tables)
    and actual_udt_name is null
),
wrong_column_types as (
  select jsonb_agg(
    table_name || '.' || column_name || ': esperado ' || expected_udt_name || ', actual ' || actual_udt_name
    order by table_name, column_name
  ) as wrong_types
  from column_checks
  where table_exists = true
    and actual_udt_name is not null
    and actual_udt_name <> expected_udt_name
),
required_functions(function_signature) as (
  values
    ('public.current_profile_role_id()'),
    ('public.can_supervise_profile_in_scope(uuid,text[])')
),
function_status as (
  select
    'function:' || function_signature as check_name,
    case
      when to_regprocedure(function_signature) is null then 'INFO'
      else 'OK'
    end as status,
    case
      when to_regprocedure(function_signature) is null
        then 'No existe todavia; esperado antes de 007.'
      else 'Existe.'
    end as detail
  from required_functions
),
expected_indexes(index_name, parent_table) as (
  values
    ('uq_gv_supervision_edges_active_scope', 'gv_supervision_edges'),
    ('idx_gv_supervision_edges_supervisor', 'gv_supervision_edges'),
    ('idx_gv_supervision_edges_subordinate', 'gv_supervision_edges'),
    ('idx_gv_advisor_availability_profile_period', 'gv_advisor_availability'),
    ('idx_gv_advisor_availability_status', 'gv_advisor_availability'),
    ('idx_gv_opportunities_asesor_stage', 'gv_opportunities'),
    ('idx_gv_opportunities_next_action', 'gv_opportunities'),
    ('idx_gv_opportunities_risk', 'gv_opportunities'),
    ('idx_gv_opportunities_operation_type', 'gv_opportunities'),
    ('idx_gv_opportunities_cliente', 'gv_opportunities'),
    ('idx_gv_opportunities_cierre', 'gv_opportunities'),
    ('idx_gv_opportunities_respond_contact', 'gv_opportunities'),
    ('uq_gv_opportunities_source_external', 'gv_opportunities'),
    ('idx_gv_opportunity_events_opportunity', 'gv_opportunity_events'),
    ('idx_gv_opportunity_events_actor', 'gv_opportunity_events'),
    ('idx_gv_respond_snapshots_profile', 'gv_respond_contact_snapshots'),
    ('idx_gv_respond_snapshots_unanswered', 'gv_respond_contact_snapshots'),
    ('uq_gv_respond_snapshots_contact', 'gv_respond_contact_snapshots'),
    ('idx_gv_management_interventions_advisor_status', 'gv_management_interventions'),
    ('idx_gv_management_interventions_actor_created', 'gv_management_interventions'),
    ('uq_gv_management_interventions_active_context', 'gv_management_interventions'),
    ('idx_cierres_advisor_profile_id', 'cierres'),
    ('idx_cierres_operation_type_structured', 'cierres'),
    ('idx_citas_asesor_confirmacion_fecha', 'citas')
),
index_conflicts as (
  select jsonb_agg(ei.index_name order by ei.index_name) as conflicts
  from expected_indexes ei
  join pg_class idx on idx.relname = ei.index_name
  join pg_namespace ns on ns.oid = idx.relnamespace and ns.nspname = 'public'
  left join pg_index pi on pi.indexrelid = idx.oid
  left join pg_class tbl on tbl.oid = pi.indrelid
  where tbl.relname is distinct from ei.parent_table
),
expected_constraints(constraint_name, parent_table) as (
  values
    ('gv_supervision_edges_no_self', 'gv_supervision_edges'),
    ('gv_supervision_edges_valid_range', 'gv_supervision_edges'),
    ('gv_advisor_availability_valid_range', 'gv_advisor_availability'),
    ('gv_opportunities_close_consistency', 'gv_opportunities'),
    ('gv_opportunity_events_no_technical_impersonation', 'gv_opportunity_events'),
    ('gv_management_interventions_context_key_not_blank', 'gv_management_interventions'),
    ('citas_confirmacion_estado_check', 'citas')
),
constraint_conflicts as (
  select jsonb_agg(ec.constraint_name order by ec.constraint_name) as conflicts
  from expected_constraints ec
  join pg_constraint con on con.conname = ec.constraint_name
  left join pg_class tbl on tbl.oid = con.conrelid
  where tbl.relname is distinct from ec.parent_table
),
active_context_duplicate_count as (
  select case
    when to_regclass('public.gv_management_interventions') is null then null
    else coalesce(
      substring(
        query_to_xml(
          'select count(*) as issue_count from (
             select advisor_profile_id, scope, indicators->>''contextKey'' as context_key
             from public.gv_management_interventions
             where status in (''pendiente'', ''en_seguimiento'', ''sin_mejora'')
               and indicators ? ''contextKey''
             group by advisor_profile_id, scope, indicators->>''contextKey''
             having count(*) > 1
           ) s',
          false,
          true,
          ''
        )::text
        from '<issue_count>([0-9]+)</issue_count>'
      )::int,
      0
    )
  end as issue_count
),
blank_context_key_count as (
  select case
    when to_regclass('public.gv_management_interventions') is null then null
    else coalesce(
      substring(
        query_to_xml(
          'select count(*) as issue_count
           from public.gv_management_interventions
           where indicators ? ''contextKey''
             and length(trim(indicators->>''contextKey'')) = 0',
          false,
          true,
          ''
        )::text
        from '<issue_count>([0-9]+)</issue_count>'
      )::int,
      0
    )
  end as issue_count
),
availability_overlap_count as (
  select case
    when to_regclass('public.gv_advisor_availability') is null then null
    else coalesce(
      substring(
        query_to_xml(
          'select count(*) as issue_count
           from public.gv_advisor_availability a
           join public.gv_advisor_availability b
             on a.profile_id = b.profile_id
            and a.id < b.id
            and daterange(a.starts_on, coalesce(a.ends_on, ''infinity''::date), ''[]'')
                && daterange(b.starts_on, coalesce(b.ends_on, ''infinity''::date), ''[]'')',
          false,
          true,
          ''
        )::text
        from '<issue_count>([0-9]+)</issue_count>'
      )::int,
      0
    )
  end as issue_count
)
select
  'required_tables' as check_name,
  case when missing is null then 'OK' else 'BLOCKER' end as status,
  case
    when missing is null then 'Tablas base requeridas presentes.'
    else 'Faltan tablas base requeridas: ' || missing::text
  end as detail
from missing_required_tables

union all
select
  'required_roles' as check_name,
  case when missing is null then 'OK' else 'BLOCKER' end as status,
  case
    when missing is null then 'Roles anon, authenticated y service_role presentes.'
    else 'Faltan roles requeridos: ' || missing::text
  end as detail
from missing_roles

union all
select
  'required_extensions' as check_name,
  case when missing is null then 'OK' else 'BLOCKER' end as status,
  case
    when missing is null then 'Extensiones requeridas presentes.'
    else 'Faltan extensiones requeridas: ' || missing::text
  end as detail
from missing_extensions

union all
select check_name, status, detail
from optional_table_status

union all
select
  'required_columns_before_007' as check_name,
  case when missing is null then 'OK' else 'BLOCKER' end as status,
  case
    when missing is null then 'Columnas base requeridas presentes.'
    else 'Faltan columnas base requeridas: ' || missing::text
  end as detail
from missing_required_columns

union all
select
  'phase_2a_partial_columns' as check_name,
  case when missing is null then 'OK' else 'BLOCKER' end as status,
  case
    when missing is null then 'Sin estructura parcial incompatible detectada.'
    else 'Existen tablas/columnas parciales incompletas: ' || missing::text
  end as detail
from missing_optional_columns

union all
select
  'base_phase_2a_columns' as check_name,
  case when missing is null then 'OK' else 'INFO' end as status,
  case
    when missing is null then 'Columnas aditivas de citas/cierres ya presentes.'
    else 'Columnas aditivas de citas/cierres no existen todavia; esperado antes de 007: ' || missing::text
  end as detail
from missing_base_phase_2a_columns

union all
select
  'critical_fk_target_types' as check_name,
  case when issues is null then 'OK' else 'BLOCKER' end as status,
  case
    when issues is null then 'Tipos de columnas historicas usadas como FK compatibles con 007.'
    else 'Incompatibilidad en columnas historicas usadas como FK: ' || issues::text
  end as detail
from critical_fk_target_issues

union all
select
  'column_type_compatibility' as check_name,
  case when wrong_types is null then 'OK' else 'BLOCKER' end as status,
  case
    when wrong_types is null then 'Tipos de columnas compatibles.'
    else 'Tipos incompatibles: ' || wrong_types::text
  end as detail
from wrong_column_types

union all
select check_name, status, detail
from function_status

union all
select
  'index_name_conflicts' as check_name,
  case when conflicts is null then 'OK' else 'BLOCKER' end as status,
  case
    when conflicts is null then 'Sin conflictos de indices esperados.'
    else 'Nombres de indices ya existen en otro objeto/tabla: ' || conflicts::text
  end as detail
from index_conflicts

union all
select
  'constraint_name_conflicts' as check_name,
  case when conflicts is null then 'OK' else 'BLOCKER' end as status,
  case
    when conflicts is null then 'Sin conflictos de constraints esperadas.'
    else 'Nombres de constraints ya existen en otra tabla: ' || conflicts::text
  end as detail
from constraint_conflicts

union all
select
  'active_context_duplicates' as check_name,
  case
    when issue_count is null then 'INFO'
    when issue_count = 0 then 'OK'
    else 'BLOCKER'
  end as status,
  case
    when issue_count is null then 'No se puede evaluar porque gv_management_interventions todavia no existe.'
    when issue_count = 0 then 'No se detectaron duplicados activos por advisor_profile_id, scope y contextKey.'
    else issue_count::text || ' duplicados activos detectados por advisor_profile_id, scope y contextKey.'
  end as detail
from active_context_duplicate_count

union all
select
  'blank_intervention_context_key' as check_name,
  case
    when issue_count is null then 'INFO'
    when issue_count = 0 then 'OK'
    else 'BLOCKER'
  end as status,
  case
    when issue_count is null then 'No se puede evaluar porque gv_management_interventions todavia no existe.'
    when issue_count = 0 then 'No se detectaron contextKey vacios.'
    else issue_count::text || ' intervenciones tienen contextKey vacio.'
  end as detail
from blank_context_key_count

union all
select
  'availability_overlap' as check_name,
  case
    when issue_count is null then 'INFO'
    when issue_count = 0 then 'OK'
    else 'BLOCKER'
  end as status,
  case
    when issue_count is null then 'No se puede evaluar porque gv_advisor_availability todavia no existe.'
    when issue_count = 0 then 'No se detectaron disponibilidades traslapadas.'
    else issue_count::text || ' periodos de disponibilidad traslapados detectados.'
  end as detail
from availability_overlap_count

order by status, check_name;
