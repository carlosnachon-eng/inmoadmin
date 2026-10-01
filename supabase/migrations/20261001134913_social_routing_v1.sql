begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Additive, server-only. No historical UPDATE/DELETE/backfill. Deploy with flag OFF.
do $$ declare dependency text; begin
  foreach dependency in array array['gv_respond_webhook_events','respond_appointment_sync',
    'sales_agent_v2_handoffs','legal_agent_v1_handoffs','sales_agent_v2_inbound_messages',
    'owner_agent_v1_inbound_messages','legal_agent_v1_inbound_messages','respond_identity_links',
    'client_identities','propiedades','citas','gv_opportunities'] loop
    if to_regclass('public.'||dependency) is null then raise exception 'social_base_dependency_missing: %',dependency; end if;
  end loop;
end $$;

create table public.social_message_routes (
  id uuid primary key default gen_random_uuid(),
  source_event_id text not null unique references public.gv_respond_webhook_events(event_id) on delete restrict,
  source_channel_id text not null check (source_channel_id in ('497382','497385','498219','515318')),
  source_message_id text not null check (length(source_message_id) between 1 and 200),
  respond_contact_id text not null check (length(respond_contact_id) between 1 and 200),
  source_platform text not null check (source_platform in ('instagram','tiktok','whatsapp','facebook_messenger')),
  source_post_id text check(length(source_post_id) between 1 and 200),
  source_comment_id text check(length(source_comment_id) between 1 and 200),
  source_ad_id text check(length(source_ad_id) between 1 and 200),
  source_campaign_id text check(length(source_campaign_id) between 1 and 200),
  source_property_id uuid references public.propiedades(id) on delete restrict,
  source_metadata jsonb check (source_metadata is null or (
    jsonb_typeof(source_metadata)='object' and source_metadata-'origin_kind'-'media_type'='{}'::jsonb
    and (not source_metadata ? 'origin_kind' or coalesce(source_metadata->>'origin_kind' in ('dm','private_reply','comment','ad','post','reel','story'),false))
    and (not source_metadata ? 'media_type' or coalesce(source_metadata->>'media_type' in ('text','image','video','audio'),false)))),
  destination text not null check (destination in ('SALES','OWNER','ADMINISTRATION','LEGAL','EXISTING_CLIENT','HUMAN_REVIEW','UNKNOWN')),
  reason text not null check (reason ~ '^[a-z_]{3,80}$'),
  identity_status text not null check (identity_status in ('confirmed','unresolved','ambiguous')),
  canonical_identity_id uuid references public.client_identities(id) on delete restrict,
  inbound_id uuid unique,
  occurred_at timestamptz not null, created_at timestamptz not null default now(),
  unique(source_channel_id,respond_contact_id,source_message_id),
  check ((destination in ('SALES','OWNER','LEGAL')) = (inbound_id is not null)),
  check ((identity_status = 'confirmed') = (canonical_identity_id is not null))
);
create index social_message_routes_contact_idx on public.social_message_routes(respond_contact_id,source_channel_id,occurred_at desc);
create index social_message_routes_review_idx on public.social_message_routes(created_at desc) where inbound_id is null;
create index social_message_routes_property_idx on public.social_message_routes(source_property_id) where source_property_id is not null;
create index social_message_routes_identity_idx on public.social_message_routes(canonical_identity_id) where canonical_identity_id is not null;
create index social_owner_context_idx on public.owner_agent_v1_inbound_messages(respond_contact_id,channel_id,occurred_at desc);
create index social_appointment_context_idx on public.respond_appointment_sync(respond_contact_id,created_at desc) where status='created' and cita_id is not null;
alter table public.social_message_routes enable row level security;
revoke all on public.social_message_routes from public,anon,authenticated,service_role;
grant select on public.social_message_routes to service_role;

alter table public.sales_agent_v2_inbound_messages add column social_route_id uuid unique references public.social_message_routes(id) on delete restrict;
alter table public.owner_agent_v1_inbound_messages add column social_route_id uuid unique references public.social_message_routes(id) on delete restrict;
alter table public.legal_agent_v1_inbound_messages add column social_route_id uuid unique references public.social_message_routes(id) on delete restrict;
alter table public.sales_agent_v2_handoffs add column social_route_id uuid references public.social_message_routes(id) on delete restrict;
alter table public.legal_agent_v1_handoffs add column social_route_id uuid references public.social_message_routes(id) on delete restrict;
alter table public.respond_appointment_sync add column social_routing_version smallint check (social_routing_version = 1);
create index social_sales_handoff_route_idx on public.sales_agent_v2_handoffs(social_route_id) where social_route_id is not null;
create index social_legal_handoff_route_idx on public.legal_agent_v1_handoffs(social_route_id) where social_route_id is not null;

create function public.guard_social_appointment_v1() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.social_routing_version = 1 and (new.social_routing_version,new.respond_contact_id,new.event_id)
    is distinct from (old.social_routing_version,old.respond_contact_id,old.event_id) then
    raise exception 'social_appointment_binding_immutable';
  end if;
  return new;
end $$;
create trigger social_appointment_binding before update on public.respond_appointment_sync for each row execute function public.guard_social_appointment_v1();

create function public.guard_social_inbound_v1() returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.social_message_routes%rowtype;
begin
  -- Same lock as capture: an in-flight legacy insertion cannot slip past exclusivity.
  if new.channel_id in ('497382','497385','498219','515318') and new.external_message_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('social:'||new.channel_id||':'||new.respond_contact_id||':'||new.external_message_id,0));
  end if;
  if tg_op = 'UPDATE' and old.social_route_id is not null and old.status <> 'captured' and new.status = 'captured' then
    raise exception 'social_reexecution_requires_review';
  end if;
  if tg_op = 'UPDATE' and (new.social_route_id is distinct from old.social_route_id
    or (old.social_route_id is not null and (new.event_id,new.external_message_id,new.channel_id,new.respond_contact_id,new.sanitized_text)
       is distinct from (old.event_id,old.external_message_id,old.channel_id,old.respond_contact_id,old.sanitized_text))) then
    raise exception 'social_inbound_binding_immutable';
  end if;
  select * into r from public.social_message_routes where id = new.social_route_id or source_event_id = new.event_id
    or (source_channel_id = new.channel_id and respond_contact_id = new.respond_contact_id and source_message_id = new.external_message_id) limit 1;
  if found and (r.destination <> tg_argv[0] or r.inbound_id <> new.id or r.id is distinct from new.social_route_id
    or r.source_channel_id <> new.channel_id or r.respond_contact_id <> new.respond_contact_id
    or r.source_event_id <> new.event_id or r.source_message_id is distinct from new.external_message_id) then
    raise exception 'social_exclusive_route_violation';
  end if;
  return new;
end $$;
create trigger social_sales_inbound_guard before insert or update on public.sales_agent_v2_inbound_messages for each row execute function public.guard_social_inbound_v1('SALES');
create trigger social_owner_inbound_guard before insert or update on public.owner_agent_v1_inbound_messages for each row execute function public.guard_social_inbound_v1('OWNER');
create trigger social_legal_inbound_guard before insert or update on public.legal_agent_v1_inbound_messages for each row execute function public.guard_social_inbound_v1('LEGAL');

create function public.bind_social_handoff_v1() returns trigger language plpgsql security definer set search_path = '' as $$
declare route_id uuid; source_contact text; source_channel text;
begin
  if tg_op = 'UPDATE' and (new.inbound_message_id,new.social_route_id,new.respond_contact_id,new.channel_id)
    is distinct from (old.inbound_message_id,old.social_route_id,old.respond_contact_id,old.channel_id) then
    if old.social_route_id is not null then raise exception 'social_handoff_binding_immutable'; end if;
  end if;
  if tg_table_name = 'sales_agent_v2_handoffs' then
    select social_route_id,respond_contact_id,channel_id into route_id,source_contact,source_channel from public.sales_agent_v2_inbound_messages where id = new.inbound_message_id;
  else
    select social_route_id,respond_contact_id,channel_id into route_id,source_contact,source_channel from public.legal_agent_v1_inbound_messages where id = new.inbound_message_id;
  end if;
  new.social_route_id := route_id;
  if route_id is not null and (new.respond_contact_id,new.channel_id) is distinct from (source_contact,source_channel) then
    raise exception 'social_handoff_contact_mismatch';
  end if;
  return new;
end $$;
create trigger social_sales_handoff_binding before insert or update on public.sales_agent_v2_handoffs for each row execute function public.bind_social_handoff_v1();
create trigger social_legal_handoff_binding before insert or update on public.legal_agent_v1_handoffs for each row execute function public.bind_social_handoff_v1();

create function public.capture_social_route_v1(p_route jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.social_message_routes%rowtype; target text; inserted_inbound uuid; hit boolean; previous_id uuid; previous_destination text;
begin
  -- Serialize conversation decisions, not only duplicate deliveries of one message.
  perform pg_advisory_xact_lock(hashtextextended('social-context:'||coalesce(p_route->>'source_channel_id','')||':'||coalesce(p_route->>'respond_contact_id',''),0));
  perform pg_advisory_xact_lock(hashtextextended('social:' || coalesce(p_route->>'source_channel_id','') || ':' || coalesce(p_route->>'respond_contact_id','') || ':' || coalesce(p_route->>'source_message_id',''),0));
  select * into r from public.social_message_routes where source_event_id = p_route->>'source_event_id'
    or (source_channel_id = p_route->>'source_channel_id' and respond_contact_id = p_route->>'respond_contact_id' and source_message_id = p_route->>'source_message_id') limit 1;
  if found then
    if r.respond_contact_id <> p_route->>'respond_contact_id' or r.source_channel_id <> p_route->>'source_channel_id' or r.source_message_id <> p_route->>'source_message_id' then raise exception 'social_event_collision'; end if;
    return jsonb_build_object('created',false,'destination',r.destination,'routeId',r.id,'inboundId',r.inbound_id);
  end if;
  select id,destination into previous_id,previous_destination from public.social_message_routes
    where respond_contact_id=p_route->>'respond_contact_id' and source_channel_id=p_route->>'source_channel_id'
      and destination <> 'HUMAN_REVIEW'
    order by occurred_at desc,created_at desc limit 1;
  if previous_id is distinct from (p_route->>'previous_route_id')::uuid then
    raise exception 'social_context_changed_requires_review';
  end if;
  if previous_destination='OWNER' and p_route->>'destination' not in ('OWNER','HUMAN_REVIEW')
    and not (p_route->>'reason'='explicit_intent_change' or (p_route->>'destination'='UNKNOWN' and p_route->>'reason'='owner_explicit_closure')) then
    raise exception 'social_owner_transition_requires_explicit_evidence';
  end if;
  -- An event already handled by legacy code must never be replayed through a second lane.
  foreach target in array array['sales_agent_v2_inbound_messages','owner_agent_v1_inbound_messages','legal_agent_v1_inbound_messages'] loop
    execute format('select exists(select 1 from public.%I where event_id=$1 or (channel_id=$2 and respond_contact_id=$3 and external_message_id=$4))', target)
      into hit using p_route->>'source_event_id',p_route->>'source_channel_id',p_route->>'respond_contact_id',p_route->>'source_message_id';
    if hit then raise exception 'social_preexisting_legacy_message'; end if;
  end loop;
  inserted_inbound := case when p_route->>'destination' in ('SALES','OWNER','LEGAL') then gen_random_uuid() else null end;
  insert into public.social_message_routes(source_event_id,source_channel_id,source_message_id,respond_contact_id,source_platform,
    source_post_id,source_comment_id,source_ad_id,source_campaign_id,source_property_id,source_metadata,
    destination,reason,identity_status,canonical_identity_id,inbound_id,occurred_at)
  values(p_route->>'source_event_id',p_route->>'source_channel_id',p_route->>'source_message_id',p_route->>'respond_contact_id',p_route->>'source_platform',
    p_route->>'source_post_id',p_route->>'source_comment_id',p_route->>'source_ad_id',p_route->>'source_campaign_id',(p_route->>'source_property_id')::uuid,nullif(p_route->'source_metadata','null'::jsonb),
    p_route->>'destination',p_route->>'reason',p_route->>'identity_status',(p_route->>'canonical_identity_id')::uuid,inserted_inbound,(p_route->>'occurred_at')::timestamptz) returning * into r;
  target := case r.destination when 'SALES' then 'sales_agent_v2_inbound_messages' when 'OWNER' then 'owner_agent_v1_inbound_messages' when 'LEGAL' then 'legal_agent_v1_inbound_messages' end;
  if target is not null then
    execute format('insert into public.%I(id,event_id,external_message_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status,debounce_until,social_route_id) values($1,$2,$3,$4,$5,$6,$7,''captured'',now()+interval ''4 seconds'',$8)',target)
      using inserted_inbound,r.source_event_id,r.source_message_id,r.respond_contact_id,r.source_channel_id,r.occurred_at,p_route->>'sanitized_text',r.id;
  end if;
  return jsonb_build_object('created',true,'destination',r.destination,'routeId',r.id,'inboundId',r.inbound_id);
end $$;

-- Durable at-most-once reservations. A crash/timeout NEVER releases a reservation.
create table public.social_handoff_effects (
  kind text not null check (kind in ('sales','legal')), handoff_id uuid not null,
  phase text not null check (phase in ('assignment','ack','sla:1','sla:2','sla:3','sla:4','sla:5')),
  token uuid not null unique default gen_random_uuid(),
  status text not null default 'reserved' check (status in ('reserved','completed','uncertain')),
  result_ref text check (length(result_ref) <= 200),
  created_at timestamptz not null default now(), completed_at timestamptz,
  primary key(kind,handoff_id,phase)
);
alter table public.social_handoff_effects enable row level security;
revoke all on public.social_handoff_effects from public,anon,authenticated,service_role;
grant select on public.social_handoff_effects to service_role;
create function public.reserve_social_effect_v1(p_kind text,p_handoff_id uuid,p_phase text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.social_handoff_effects%rowtype; route_id uuid; owned boolean;
begin
  if p_kind = 'sales' then select social_route_id into route_id from public.sales_agent_v2_handoffs where id=p_handoff_id;
  elsif p_kind = 'legal' then select social_route_id into route_id from public.legal_agent_v1_handoffs where id=p_handoff_id;
  end if;
  if route_id is null then raise exception 'social_handoff_not_bound'; end if;
  if p_phase='ack' and not exists(select 1 from public.social_handoff_effects where kind=p_kind and handoff_id=p_handoff_id and phase='assignment' and status='completed') then raise exception 'social_assignment_not_completed'; end if;
  insert into public.social_handoff_effects(kind,handoff_id,phase) values(p_kind,p_handoff_id,p_phase)
    on conflict do nothing returning * into e;
  owned := found;
  if not owned then select * into e from public.social_handoff_effects where kind=p_kind and handoff_id=p_handoff_id and phase=p_phase; end if;
  return jsonb_build_object('owned',owned,'token',case when owned then e.token else null end,'status',e.status,'resultRef',e.result_ref);
end $$;
create function public.finish_social_effect_v1(p_token uuid,p_status text,p_result_ref text default null) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('completed','uncertain') then raise exception 'social_effect_invalid_status'; end if;
  update public.social_handoff_effects set status=p_status,result_ref=p_result_ref,completed_at=now() where token=p_token and status='reserved';
  if not found then raise exception 'social_effect_already_consumed'; end if;
end $$;

-- A booking key belongs to the existing appointment sync/citas flow, not a second scheduler.
create table public.social_appointment_keys (
  sync_id uuid primary key references public.respond_appointment_sync(id) on delete restrict,
  cita_id uuid not null references public.citas(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index social_appointment_keys_cita_idx on public.social_appointment_keys(cita_id);
alter table public.social_appointment_keys enable row level security;
revoke all on public.social_appointment_keys from public,anon,authenticated,service_role;
grant select on public.social_appointment_keys to service_role;
create function public.commit_social_appointment_v1(p_sync_id uuid,p_advisor_id uuid,p_client_id uuid,p_property_id uuid,p_at timestamptz,p_source_at timestamptz,p_excerpt text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.respond_appointment_sync%rowtype; c uuid; existing boolean; clients uuid[];
begin
  select * into s from public.respond_appointment_sync where id=p_sync_id for update;
  if not found or s.social_routing_version is distinct from 1 then raise exception 'social_appointment_not_bound'; end if;
  select cita_id into c from public.social_appointment_keys where sync_id=s.id;
  if found then return jsonb_build_object('status','already_exists','citaId',c); end if;
  if s.status <> 'pending' then raise exception 'social_appointment_not_pending'; end if;
  if exists(select 1 from public.respond_identity_links where respond_contact_id=s.respond_contact_id and link_status='conflict') then raise exception 'social_identity_ambiguous'; end if;
  if (select count(*) from public.respond_identity_links where respond_contact_id=s.respond_contact_id and link_status='confirmed') > 1 then raise exception 'social_identity_ambiguous'; end if;
  -- clientes != client_identities/users: only a unique explicit opportunity link is usable here.
  select array_agg(distinct cliente_id) filter(where cliente_id is not null) into clients from public.gv_opportunities where respond_contact_id=s.respond_contact_id;
  if coalesce(cardinality(clients),0) <> 1 or clients[1] <> p_client_id then raise exception 'social_client_link_not_unique'; end if;
  if p_advisor_id is null or p_client_id is null or p_property_id is null or p_at is null then raise exception 'social_appointment_missing_context'; end if;
  -- Serialize all dates for this existing advisor/client/property tuple (preserves +/-30m rule).
  perform pg_advisory_xact_lock(hashtextextended('social-cita:'||p_advisor_id||':'||p_client_id||':'||p_property_id,0));
  select id into c from public.citas where asesor_id=p_advisor_id and cliente_id=p_client_id and propiedad_id=p_property_id
    and fecha_hora between p_at-interval '30 minutes' and p_at+interval '30 minutes' order by fecha_hora,id limit 1;
  existing := found;
  if not existing then
    insert into public.citas(cliente_id,propiedad_id,asesor_id,fecha_hora,estado,notas,confirmacion_estado,confirmacion_actualizada_at,confirmacion_actualizada_por)
      values(p_client_id,p_property_id,p_advisor_id,p_at,'agendada','Cita desde Respond; referencia en respond_appointment_sync.','confirmada',now(),p_advisor_id) returning id into c;
  end if;
  insert into public.social_appointment_keys(sync_id,cita_id) values(s.id,c);
  update public.respond_appointment_sync set status='created',advisor_profile_id=p_advisor_id,cliente_id=p_client_id,propiedad_id=p_property_id,
    appointment_at=p_at,cita_id=c,source_message_at=p_source_at,source_message_excerpt=left(p_excerpt,500),updated_at=now() where id=s.id;
  return jsonb_build_object('status',case when existing then 'already_exists' else 'created' end,'citaId',c,'appointmentAt',p_at);
end $$;

revoke all on function public.capture_social_route_v1(jsonb),public.reserve_social_effect_v1(text,uuid,text),public.finish_social_effect_v1(uuid,text,text),public.commit_social_appointment_v1(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text),public.guard_social_inbound_v1(),public.bind_social_handoff_v1(),public.guard_social_appointment_v1() from public,anon,authenticated;
grant execute on function public.capture_social_route_v1(jsonb),public.reserve_social_effect_v1(text,uuid,text),public.finish_social_effect_v1(uuid,text,text),public.commit_social_appointment_v1(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text) to service_role;
do $$ begin
  if not (select relrowsecurity from pg_class where oid='public.social_message_routes'::regclass)
    or has_function_privilege('authenticated','public.capture_social_route_v1(jsonb)','EXECUTE')
    or has_table_privilege('authenticated','public.social_handoff_effects','SELECT') then raise exception 'social_acl_postcheck_failed'; end if;
end $$;
commit;
