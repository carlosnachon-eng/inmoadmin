-- Read-only checks posteriores a 202608210002. No crean ni modifican datos.
do $$
declare open_policy_count integer; legacy_count bigint;
begin
  if to_regclass('public.inmoadmin_operational_events') is null
     or to_regclass('public.shadow_operational_events') is null then
    raise exception 'Faltan tablas Operational Events';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='maintenance_tickets' and column_name='maintenance_scope' and data_type='text' and is_nullable='YES')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='maintenance_tickets' and column_name='external_job_reference' and data_type='text' and is_nullable='YES') then
    raise exception 'Columnas maintenance_scope/external_job_reference incompatibles';
  end if;
  if obj_description('public.inmoadmin_operational_events'::regclass) <> 'production-migration:202608210002:fase-2a-shadow-operational-outbox'
     or obj_description('public.shadow_operational_events'::regclass) <> 'production-migration:202608210002:fase-2a-shadow-operational-events' then
    raise exception 'Marcadores de ownership inesperados';
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.maintenance_tickets'::regclass and conname='maintenance_tickets_scope_check')
     or not exists(select 1 from pg_constraint where conrelid='public.inmoadmin_operational_events'::regclass and conname='operational_event_scope_check')
     or not exists(select 1 from pg_constraint where conrelid='public.inmoadmin_operational_events'::regclass and conname='operational_quote_shape_check') then
    raise exception 'Constraints Operational Events incompletos';
  end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='inmoadmin_operational_events_pending_idx')
     or not exists(select 1 from pg_indexes where schemaname='public' and indexname='inmoadmin_operational_events_ticket_idx')
     or not exists(select 1 from pg_indexes where schemaname='public' and indexname='shadow_operational_events_ticket_idx') then
    raise exception 'Índices Operational Events incompletos';
  end if;
  if not exists(select 1 from pg_class where oid='public.inmoadmin_operational_events'::regclass and relrowsecurity)
     or not exists(select 1 from pg_class where oid='public.shadow_operational_events'::regclass and relrowsecurity) then
    raise exception 'RLS no habilitado';
  end if;
  if has_table_privilege('anon','public.inmoadmin_operational_events','SELECT')
     or has_table_privilege('anon','public.inmoadmin_operational_events','INSERT')
     or has_table_privilege('anon','public.inmoadmin_operational_events','UPDATE')
     or has_table_privilege('anon','public.inmoadmin_operational_events','DELETE')
     or has_table_privilege('anon','public.shadow_operational_events','SELECT')
     or has_table_privilege('anon','public.shadow_operational_events','INSERT')
     or has_table_privilege('anon','public.shadow_operational_events','UPDATE')
     or has_table_privilege('anon','public.shadow_operational_events','DELETE') then
    raise exception 'anon conserva privilegios indebidos';
  end if;
  if has_table_privilege('authenticated','public.inmoadmin_operational_events','SELECT')
     or has_table_privilege('authenticated','public.inmoadmin_operational_events','INSERT')
     or has_table_privilege('authenticated','public.inmoadmin_operational_events','UPDATE')
     or has_table_privilege('authenticated','public.inmoadmin_operational_events','DELETE')
     or has_table_privilege('authenticated','public.shadow_operational_events','INSERT')
     or has_table_privilege('authenticated','public.shadow_operational_events','UPDATE')
     or has_table_privilege('authenticated','public.shadow_operational_events','DELETE') then
    raise exception 'authenticated conserva escritura/outbox indebida';
  end if;
  if not has_table_privilege('authenticated','public.shadow_operational_events','SELECT')
     or not has_table_privilege('service_role','public.inmoadmin_operational_events','SELECT')
     or not has_table_privilege('service_role','public.inmoadmin_operational_events','INSERT')
     or not has_table_privilege('service_role','public.inmoadmin_operational_events','UPDATE')
     or not has_table_privilege('service_role','public.inmoadmin_operational_events','DELETE')
     or not has_table_privilege('service_role','public.shadow_operational_events','SELECT')
     or not has_table_privilege('service_role','public.shadow_operational_events','INSERT')
     or not has_table_privilege('service_role','public.shadow_operational_events','UPDATE')
     or not has_table_privilege('service_role','public.shadow_operational_events','DELETE') then
    raise exception 'Grants esperados incompletos';
  end if;
  select count(*) into open_policy_count from pg_policies
   where schemaname='public' and tablename in ('inmoadmin_operational_events','shadow_operational_events')
     and (lower(coalesce(qual,'')) in ('true','(true)') or lower(coalesce(with_check,'')) in ('true','(true)'));
  if open_policy_count<>0 then raise exception 'Policy abierta detectada'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='shadow_operational_events' and policyname='shadow_operational_read_authorized' and roles='{authenticated}' and cmd='SELECT')
     or exists(select 1 from pg_policies where schemaname='public' and tablename='inmoadmin_operational_events') then
    raise exception 'Policies inesperadas';
  end if;
  if not has_function_privilege('authenticated','public.create_maintenance_ticket_with_event(jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.approve_maintenance_quote_with_event(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.process_operational_event(uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.approve_maintenance_quote_with_event(uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.process_operational_event(uuid)','EXECUTE') then
    raise exception 'Grants de funciones incompatibles';
  end if;
  if exists(select 1 from information_schema.triggers where event_object_schema='public' and event_object_table in ('inmoadmin_operational_events','shadow_operational_events')) then
    raise exception 'Triggers inesperados en carril Operational Events';
  end if;
  if exists(select 1 from public.inmoadmin_operational_events) or exists(select 1 from public.shadow_operational_events) then
    raise exception 'Instalación inicial no está vacía';
  end if;
  select count(*) into legacy_count from public.maintenance_tickets where maintenance_scope is null;
  raise notice 'Checks Operational Events OK; filas legacy preservadas con scope NULL: %',legacy_count;
end $$;
