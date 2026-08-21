-- Rollback conservador Production. Se niega a borrar auditoría o metadata operativa.
begin;

do $$ begin
  if to_regclass('public.inmoadmin_operational_events') is null
     or to_regclass('public.shadow_operational_events') is null
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='maintenance_tickets' and column_name='maintenance_scope')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='maintenance_tickets' and column_name='external_job_reference')
     or obj_description('public.inmoadmin_operational_events'::regclass) <> 'production-migration:202608210002:fase-2a-shadow-operational-outbox'
     or obj_description('public.shadow_operational_events'::regclass) <> 'production-migration:202608210002:fase-2a-shadow-operational-events'
     or obj_description('public.shadow_operational_authorized_role()'::regprocedure,'pg_proc') <> 'production-migration:202608210002'
     or obj_description('public.create_maintenance_ticket_with_event(jsonb)'::regprocedure,'pg_proc') <> 'production-migration:202608210002'
     or obj_description('public.approve_maintenance_quote_with_event(uuid)'::regprocedure,'pg_proc') <> 'production-migration:202608210002'
     or obj_description('public.process_operational_event(uuid)'::regprocedure,'pg_proc') <> 'production-migration:202608210002'
     or col_description('public.maintenance_tickets'::regclass,(select attnum from pg_attribute where attrelid='public.maintenance_tickets'::regclass and attname='maintenance_scope')) not like 'production-migration:202608210002;%'
     or col_description('public.maintenance_tickets'::regclass,(select attnum from pg_attribute where attrelid='public.maintenance_tickets'::regclass and attname='external_job_reference')) not like 'production-migration:202608210002;%' then
    raise exception 'Ownership no demostrable; rollback detenido';
  end if;
  if exists(select 1 from public.inmoadmin_operational_events)
     or exists(select 1 from public.shadow_operational_events)
     or exists(select 1 from public.shadow_ingestion_events where provider='inmoadmin') then
    raise exception 'Existen eventos productivos/auditoría; rollback destructivo rechazado';
  end if;
  if exists(select 1 from public.maintenance_tickets where maintenance_scope is not null or external_job_reference is not null) then
    raise exception 'Existen tickets estructurados; rollback rechazado';
  end if;
end $$;

drop function public.process_operational_event(uuid);
drop function public.approve_maintenance_quote_with_event(uuid);
drop function public.create_maintenance_ticket_with_event(jsonb);
drop function public.shadow_operational_authorized_role();
drop table public.shadow_operational_events;
drop table public.inmoadmin_operational_events;
alter table public.maintenance_tickets drop constraint maintenance_tickets_scope_check;
alter table public.maintenance_tickets drop column external_job_reference;
alter table public.maintenance_tickets drop column maintenance_scope;

commit;
