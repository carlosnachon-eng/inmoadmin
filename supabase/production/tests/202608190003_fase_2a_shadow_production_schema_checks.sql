-- Checks post-migración. No insertan ni modifican datos.
do $$
declare
  table_name text;
  object_count bigint;
begin
  foreach table_name in array array[
    'shadow_conversations','shadow_messages','shadow_ingestion_events',
    'shadow_context_matches','shadow_context_query_audit','shadow_human_evaluations',
    'shadow_ai_runs','shadow_ai_decisions'
  ] loop
    if to_regclass('public.' || table_name) is null then raise exception 'Falta tabla %', table_name; end if;
    if coalesce(obj_description(to_regclass('public.' || table_name),'pg_class'),'')
       <> 'production-migration:202608190003:fase-2a-shadow' then raise exception 'Marcador incorrecto en %', table_name; end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || table_name)) then raise exception 'RLS inactivo en %', table_name; end if;
    if has_table_privilege('anon','public.' || table_name,'select')
       or has_table_privilege('anon','public.' || table_name,'insert')
       or has_table_privilege('anon','public.' || table_name,'update')
       or has_table_privilege('anon','public.' || table_name,'delete') then raise exception 'anon tiene acceso a %', table_name; end if;
    if has_table_privilege('authenticated','public.' || table_name,'update')
       or has_table_privilege('authenticated','public.' || table_name,'delete') then raise exception 'authenticated puede modificar %', table_name; end if;
    if table_name <> 'shadow_human_evaluations' and has_table_privilege('authenticated','public.' || table_name,'insert') then raise exception 'authenticated puede insertar en %', table_name; end if;
    execute format('select count(*) from public.%I', table_name) into object_count;
    if object_count <> 0 then raise exception 'Tabla % no está vacía', table_name; end if;
  end loop;
  if not has_table_privilege('authenticated','public.shadow_human_evaluations','insert') then raise exception 'Falta INSERT de evaluaciones'; end if;
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename like 'shadow_%'
      and (lower(coalesce(qual,'')) = 'true' or lower(coalesce(with_check,'')) = 'true')
  ) then raise exception 'Policy Shadow abierta'; end if;
  if exists (
    select 1 from pg_trigger
    where tgrelid in (
      select to_regclass('public.' || name)
      from (values
        ('shadow_conversations'),('shadow_messages'),('shadow_ingestion_events'),
        ('shadow_context_matches'),('shadow_context_query_audit'),('shadow_human_evaluations'),
        ('shadow_ai_runs'),('shadow_ai_decisions')
      ) objects(name)
    ) and not tgisinternal
  ) then raise exception 'Trigger no esperado en tablas Shadow'; end if;
  if has_function_privilege('anon','public.ingest_shadow_message(jsonb,jsonb)','execute')
     or has_function_privilege('authenticated','public.ingest_shadow_message(jsonb,jsonb)','execute')
     or not has_function_privilege('service_role','public.ingest_shadow_message(jsonb,jsonb)','execute') then
    raise exception 'Grants incorrectos en ingest_shadow_message';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.shadow_conversations'::regclass
      and conname='shadow_conversations_provider_check'
      and pg_get_constraintdef(oid) like '%respond_admin%'
  ) then raise exception 'Provider respond_admin ausente'; end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.shadow_messages'::regclass
      and conname='shadow_messages_direction_check'
      and pg_get_constraintdef(oid) like '%outbound_human%'
  ) then raise exception 'Dirección outbound_human ausente'; end if;
end $$;

select
  (select count(*) from public.shadow_conversations) as conversations,
  (select count(*) from public.shadow_messages) as messages,
  (select count(*) from public.shadow_ingestion_events) as ingestion_events,
  (select count(*) from public.shadow_context_matches) as context_matches,
  (select count(*) from public.shadow_context_query_audit) as query_audits,
  (select count(*) from public.shadow_human_evaluations) as evaluations,
  (select count(*) from public.shadow_ai_runs) as ai_runs,
  (select count(*) from public.shadow_ai_decisions) as ai_decisions;
