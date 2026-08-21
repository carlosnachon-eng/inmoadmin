-- Production: Fase 2A Operational Events / mantenimiento. Schema vacío, sin seed ni backfill.
begin;

do $$ begin
  if to_regclass('public.maintenance_tickets') is null
     or to_regclass('public.maintenance_quotes') is null
     or to_regclass('public.properties') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.shadow_ingestion_events') is null
     or to_regprocedure('public.current_profile_role_id()') is null then
    raise exception 'Dependencias Production incompletas para Operational Events';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='maintenance_tickets' and column_name in ('maintenance_scope','external_job_reference'))
     or to_regclass('public.inmoadmin_operational_events') is not null
     or to_regclass('public.shadow_operational_events') is not null
     or to_regprocedure('public.shadow_operational_authorized_role()') is not null
     or to_regprocedure('public.create_maintenance_ticket_with_event(jsonb)') is not null
     or to_regprocedure('public.approve_maintenance_quote_with_event(uuid)') is not null
     or to_regprocedure('public.process_operational_event(uuid)') is not null then
    raise exception 'Colisión o instalación parcial de Operational Events; detener y auditar';
  end if;
end $$;

alter table public.maintenance_tickets add column maintenance_scope text;
alter table public.maintenance_tickets add column external_job_reference text;
comment on column public.maintenance_tickets.maintenance_scope is 'production-migration:202608210002; managed_property|external_job; NULL preservado para filas legacy';
comment on column public.maintenance_tickets.external_job_reference is 'production-migration:202608210002; referencia segura no-PII para external_job';
alter table public.maintenance_tickets add constraint maintenance_tickets_scope_check check (
  maintenance_scope is null
  or (maintenance_scope='managed_property' and property_id is not null and external_job_reference is null)
  or (maintenance_scope='external_job' and property_id is null and external_job_reference is not null and length(external_job_reference) between 1 and 120)
);

create table public.inmoadmin_operational_events (
  event_id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('maintenance_ticket_created','maintenance_quote_approved')),
  aggregate_type text not null check (aggregate_type in ('maintenance_ticket','maintenance_quote')),
  aggregate_id uuid not null,
  ticket_id uuid not null references public.maintenance_tickets(id) on delete restrict,
  quote_id uuid references public.maintenance_quotes(id) on delete restrict,
  property_id uuid references public.properties(id) on delete restrict,
  maintenance_scope text not null check (maintenance_scope in ('managed_property','external_job')),
  occurred_at timestamptz not null,
  payload_safe jsonb not null check (jsonb_typeof(payload_safe)='object'),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 200),
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by uuid,
  processed_at timestamptz,
  last_error text check (length(last_error)<=500),
  created_at timestamptz not null default now(),
  constraint operational_event_scope_check check (
    (maintenance_scope='managed_property' and property_id is not null)
    or (maintenance_scope='external_job' and property_id is null)
  ),
  constraint operational_quote_shape_check check (
    (event_type='maintenance_ticket_created' and quote_id is null and aggregate_type='maintenance_ticket')
    or (event_type='maintenance_quote_approved' and quote_id is not null and aggregate_type='maintenance_quote')
  )
);
comment on table public.inmoadmin_operational_events is 'production-migration:202608210002:fase-2a-shadow-operational-outbox';
create index inmoadmin_operational_events_pending_idx on public.inmoadmin_operational_events(processed_at,next_attempt_at,created_at) where processed_at is null;
create index inmoadmin_operational_events_ticket_idx on public.inmoadmin_operational_events(ticket_id,occurred_at);

create table public.shadow_operational_events (
  id uuid primary key default gen_random_uuid(),
  ingestion_event_id uuid not null references public.shadow_ingestion_events(id) on delete restrict,
  source text not null check (source='inmoadmin'),
  kind text not null check (kind='operational_event'),
  event_type text not null check (event_type in ('maintenance_ticket_created','maintenance_quote_approved')),
  aggregate_type text not null,
  aggregate_id uuid not null,
  ticket_id uuid not null references public.maintenance_tickets(id) on delete restrict,
  quote_id uuid references public.maintenance_quotes(id) on delete restrict,
  property_id uuid references public.properties(id) on delete restrict,
  maintenance_scope text not null check (maintenance_scope in ('managed_property','external_job')),
  occurred_at timestamptz not null,
  payload_safe jsonb not null check (jsonb_typeof(payload_safe)='object'),
  requires_human boolean not null default false,
  created_at timestamptz not null default now(),
  unique(source,event_type,aggregate_id)
);
comment on table public.shadow_operational_events is 'production-migration:202608210002:fase-2a-shadow-operational-events';
create index shadow_operational_events_ticket_idx on public.shadow_operational_events(ticket_id,occurred_at desc);

create function public.shadow_operational_authorized_role() returns boolean language sql stable security definer set search_path=public as $$
  select public.current_profile_role_id() in ('admin','coord_operaciones')
$$;
comment on function public.shadow_operational_authorized_role() is 'production-migration:202608210002';

alter table public.inmoadmin_operational_events enable row level security;
alter table public.shadow_operational_events enable row level security;
revoke all on public.inmoadmin_operational_events, public.shadow_operational_events from public,anon,authenticated;
grant all on public.inmoadmin_operational_events, public.shadow_operational_events to service_role;
grant select on public.shadow_operational_events to authenticated;
create policy shadow_operational_read_authorized on public.shadow_operational_events for select to authenticated using (public.shadow_operational_authorized_role());

create function public.create_maintenance_ticket_with_event(p_ticket jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.maintenance_tickets; scope text:=p_ticket->>'maintenanceScope'; prop uuid:=nullif(p_ticket->>'propertyId','')::uuid; ref text:=nullif(trim(p_ticket->>'workReference'),''); idem text;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'Sesión activa requerida'; end if;
  if not ((scope='managed_property' and prop is not null and ref is null) or (scope='external_job' and prop is null and ref is not null and length(ref)<=120 and ref ~ '^[A-Za-z0-9][A-Za-z0-9 ._:/#-]{0,119}$' and ref !~* '(https?://|@|[+]?[0-9][0-9 .-]{8,})')) then raise exception 'maintenance_scope inconsistente'; end if;
  insert into public.maintenance_tickets(property_id,condominio_id,maintenance_scope,external_job_reference,property_name,tenant_name,title,description,category,priority,status,payer,provider_cost,charged_amount,advance_amount,advance_paid,created_by,fotos)
  values(prop,nullif(p_ticket->>'condominiumId','')::uuid,scope,ref,nullif(p_ticket->>'propertyName',''),nullif(p_ticket->>'tenantName',''),left(p_ticket->>'title',300),left(p_ticket->>'description',2000),coalesce(nullif(p_ticket->>'category',''),'otro'),coalesce(nullif(p_ticket->>'priority',''),'media'),'nuevo',coalesce(nullif(p_ticket->>'payer',''),'propietario'),coalesce(nullif(p_ticket->>'providerCost','')::numeric,0),coalesce(nullif(p_ticket->>'chargedAmount','')::numeric,0),coalesce(nullif(p_ticket->>'advanceAmount','')::numeric,0),coalesce(nullif(p_ticket->>'advancePaid','')::boolean,false),(select email from public.profiles where id=auth.uid()),case when jsonb_typeof(p_ticket->'photos')='array' then p_ticket->'photos' else '[]'::jsonb end) returning * into t;
  idem:='maintenance_ticket_created:'||t.id;
  insert into public.inmoadmin_operational_events(event_type,aggregate_type,aggregate_id,ticket_id,property_id,maintenance_scope,occurred_at,payload_safe,idempotency_key)
  values('maintenance_ticket_created','maintenance_ticket',t.id,t.id,t.property_id,t.maintenance_scope,t.created_at,jsonb_strip_nulls(jsonb_build_object('eventType','maintenance_ticket_created','ticketId',t.id,'maintenanceScope',t.maintenance_scope,'propertyId',t.property_id,'workReference',t.external_job_reference,'priority',t.priority,'payer',t.payer,'status',t.status,'occurredAt',t.created_at)),idem);
  return jsonb_build_object('ticketId',t.id,'eventType','maintenance_ticket_created');
end $$;
comment on function public.create_maintenance_ticket_with_event(jsonb) is 'production-migration:202608210002';

create function public.approve_maintenance_quote_with_event(p_quote_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare q public.maintenance_quotes; t public.maintenance_tickets; ts timestamptz:=clock_timestamp(); idem text;
begin
  select * into q from public.maintenance_quotes where id=p_quote_id for update;
  if q.id is null then raise exception 'Cotización inexistente'; end if;
  select * into t from public.maintenance_tickets where id=q.ticket_id for update;
  if t.id is null or t.maintenance_scope is null then raise exception 'Ticket sin maintenance_scope estructurado'; end if;
  if q.status='aprobada' and t.status='aprobado' then return jsonb_build_object('quoteId',q.id,'ticketId',t.id,'duplicate',true); end if;
  if q.status<>'pendiente' then raise exception 'Cotización no aprobable'; end if;
  update public.maintenance_quotes set status='aprobada',updated_at=ts where id=q.id returning * into q;
  update public.maintenance_tickets set status='aprobado',charged_amount=q.monto_final,updated_at=ts where id=t.id returning * into t;
  idem:='maintenance_quote_approved:'||q.id;
  insert into public.inmoadmin_operational_events(event_type,aggregate_type,aggregate_id,ticket_id,quote_id,property_id,maintenance_scope,occurred_at,payload_safe,idempotency_key)
  values('maintenance_quote_approved','maintenance_quote',q.id,t.id,q.id,t.property_id,t.maintenance_scope,ts,jsonb_strip_nulls(jsonb_build_object('eventType','maintenance_quote_approved','quoteId',q.id,'ticketId',t.id,'maintenanceScope',t.maintenance_scope,'propertyId',t.property_id,'workReference',t.external_job_reference,'quoteStatus',q.status,'ticketStatus',t.status,'amount',q.monto_final,'providerCost',q.costo_proveedor,'payer',q.payer,'occurredAt',ts)),idem)
  on conflict(idempotency_key) do nothing;
  return jsonb_build_object('quoteId',q.id,'ticketId',t.id,'eventType','maintenance_quote_approved');
end $$;
comment on function public.approve_maintenance_quote_with_event(uuid) is 'production-migration:202608210002';

create function public.process_operational_event(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare e public.inmoadmin_operational_events; ingest uuid; shadow_id uuid; fingerprint text;
begin
  select * into e from public.inmoadmin_operational_events where event_id=p_event_id and processed_at is null for update;
  if e.event_id is null then return jsonb_build_object('status','already_processed'); end if;
  fingerprint:=encode(extensions.digest(e.idempotency_key,'sha256'),'hex');
  insert into public.shadow_ingestion_events(provider,external_event_id,payload_fingerprint,status,sanitization_changed,processed_at)
  values('inmoadmin',e.idempotency_key,fingerprint,'accepted',false,now()) on conflict(provider,payload_fingerprint) do update set duplicate_count=public.shadow_ingestion_events.duplicate_count+1 returning id into ingest;
  insert into public.shadow_operational_events(ingestion_event_id,source,kind,event_type,aggregate_type,aggregate_id,ticket_id,quote_id,property_id,maintenance_scope,occurred_at,payload_safe)
  values(ingest,'inmoadmin','operational_event',e.event_type,e.aggregate_type,e.aggregate_id,e.ticket_id,e.quote_id,e.property_id,e.maintenance_scope,e.occurred_at,e.payload_safe)
  on conflict(source,event_type,aggregate_id) do nothing returning id into shadow_id;
  update public.inmoadmin_operational_events set processed_at=now(),locked_at=null,locked_by=null,last_error=null where event_id=e.event_id;
  return jsonb_build_object('status',case when shadow_id is null then 'duplicate' else 'accepted' end,'operationalEventId',shadow_id);
end $$;
comment on function public.process_operational_event(uuid) is 'production-migration:202608210002';

revoke all on function public.create_maintenance_ticket_with_event(jsonb), public.approve_maintenance_quote_with_event(uuid), public.process_operational_event(uuid), public.shadow_operational_authorized_role() from public,anon,authenticated;
grant execute on function public.create_maintenance_ticket_with_event(jsonb) to authenticated,service_role;
grant execute on function public.approve_maintenance_quote_with_event(uuid), public.process_operational_event(uuid) to service_role;
grant execute on function public.shadow_operational_authorized_role() to authenticated,service_role;

commit;
