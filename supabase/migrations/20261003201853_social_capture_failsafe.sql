begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- New receipts only: no historical backfill, no snapshot-worker changes.
do $$ begin
  if to_regprocedure('public.capture_social_route_v1(jsonb)') is null
    or to_regclass('public.gv_respond_webhook_events') is null then
    raise exception 'social_capture_baseline_missing';
  end if;
end $$;

create table public.social_capture_receipts (
  source_event_id text primary key references public.gv_respond_webhook_events(event_id) on delete restrict,
  respond_contact_id text not null check (respond_contact_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  source_channel_id text not null check (source_channel_id in ('497382','497385','498219','515318')),
  source_message_id text check (source_message_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  routing_state text not null default 'pending' check (routing_state in ('pending','routed','review_required')),
  route_id uuid references public.social_message_routes(id) on delete restrict,
  attempts integer not null default 0 check (attempts >= 0),
  sqlstate text check (sqlstate in ('P0001','23505','23503','23514','42501','40001','40P01','55P03','57014','08006','PGRST202','PGRST205')),
  reason text check (reason in ('capture_failed','invalid_message_identity','identity_read_failed','context_read_failed','reference_read_failed','capture_rpc_failed','context_conflict','late_message_requires_review','preexisting_transport_requires_review')),
  stage text check (stage in ('transport','identity','context','reference','capture_rpc')),
  rpc_name text check (rpc_name in ('read_social_route_context_v1','capture_social_route_v1')),
  first_received_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  completed_at timestamptz,
  unique(source_channel_id,respond_contact_id,source_message_id),
  check (routing_state <> 'routed' or route_id is not null),
  check (routing_state <> 'review_required' or reason is not null)
);
alter table public.social_capture_receipts enable row level security;
revoke all on public.social_capture_receipts from public,anon,authenticated,service_role;
grant select on public.social_capture_receipts to service_role;
create index social_capture_review_idx on public.social_capture_receipts(first_received_at,source_event_id)
  where routing_state in ('pending','review_required');
create index social_route_head_idx on public.social_message_routes
  (respond_contact_id,source_channel_id,occurred_at desc,created_at desc,id desc)
  where destination <> 'HUMAN_REVIEW';

-- Receipt and transport are committed together. A crash before routing leaves
-- a visible pending receipt; snapshot completion cannot clear it.
create function public.seed_social_capture_receipt_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.event_type='message.received' and new.payload_meta->>'social_capture_required'='true'
    and new.payload_meta->>'channel_id' in ('497382','497385','498219','515318') then
    insert into public.social_capture_receipts(source_event_id,respond_contact_id,source_channel_id,source_message_id)
    values(new.event_id,new.respond_contact_id,new.payload_meta->>'channel_id',new.message_id)
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger social_capture_receipt_after_transport after insert on public.gv_respond_webhook_events
  for each row execute function public.seed_social_capture_receipt_v1();

-- The caller and writer invoke this SAME selector. UUID is the final total-order
-- tie-break when both timestamps tie. Historical context is not the CAS token.
create function public.read_social_route_context_v1(p_contact_id text,p_channel_id text,p_at timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'current',(select to_jsonb(h) from (select id,destination,reason,occurred_at,created_at
      from public.social_message_routes where respond_contact_id=p_contact_id and source_channel_id=p_channel_id
      and destination <> 'HUMAN_REVIEW' order by occurred_at desc,created_at desc,id desc limit 1) h),
    'historical',(select to_jsonb(h) from (select id,destination,reason,occurred_at,created_at
      from public.social_message_routes where respond_contact_id=p_contact_id and source_channel_id=p_channel_id
      and destination <> 'HUMAN_REVIEW' and occurred_at <= p_at
      order by occurred_at desc,created_at desc,id desc limit 1) h));
$$;

create function public.begin_social_capture_v1(p_event_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.gv_respond_webhook_events%rowtype; c public.social_capture_receipts%rowtype; r public.social_message_routes%rowtype;
begin
  select * into strict e from public.gv_respond_webhook_events where event_id=p_event_id;
  perform pg_advisory_xact_lock(hashtextextended('social-context:'||coalesce(e.payload_meta->>'channel_id','')||':'||e.respond_contact_id,0));
  select * into c from public.social_capture_receipts where source_event_id=e.event_id
    or (source_channel_id=e.payload_meta->>'channel_id' and respond_contact_id=e.respond_contact_id and source_message_id=e.message_id);
  if not found then
    -- A delivery originally captured before this rollout must not be silently
    -- replayed. Link its existing decision, or expose a terminal review. This is
    -- delivery-scoped compatibility, NOT a historical sweep/backfill.
    if e.event_type<>'message.received' or coalesce(e.payload_meta->>'channel_id','') not in ('497382','497385','498219','515318') then
      raise exception 'social_capture_receipt_missing';
    end if;
    select * into r from public.social_message_routes where source_event_id=e.event_id
      or (source_channel_id=e.payload_meta->>'channel_id' and respond_contact_id=e.respond_contact_id and source_message_id=e.message_id) limit 1;
    insert into public.social_capture_receipts(source_event_id,respond_contact_id,source_channel_id,source_message_id,routing_state,route_id,reason,stage,completed_at)
      values(e.event_id,e.respond_contact_id,e.payload_meta->>'channel_id',e.message_id,
        case when r.id is not null then 'routed' else 'review_required' end,r.id,
        case when r.id is null then 'preexisting_transport_requires_review' end,'transport',clock_timestamp()) returning * into c;
  end if;
  if (c.respond_contact_id,c.source_channel_id,c.source_message_id)
    is distinct from (e.respond_contact_id,e.payload_meta->>'channel_id',e.message_id) then raise exception 'social_event_collision'; end if;
  update public.social_capture_receipts set attempts=attempts+1,last_attempt_at=clock_timestamp()
    where source_event_id=c.source_event_id returning * into c;
  return jsonb_build_object('state',c.routing_state,'reason',c.reason,'routeId',c.route_id,
    'occurredAt',coalesce(e.event_occurred_at,c.first_received_at));
end $$;

create function public.fail_social_capture_v1(p_event_id text,p_sqlstate text,p_reason text,p_stage text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.gv_respond_webhook_events%rowtype; c public.social_capture_receipts%rowtype;
begin
  select * into strict e from public.gv_respond_webhook_events where event_id=p_event_id;
  perform pg_advisory_xact_lock(hashtextextended('social-context:'||coalesce(e.payload_meta->>'channel_id','')||':'||e.respond_contact_id,0));
  select * into strict c from public.social_capture_receipts where source_event_id=e.event_id
    or (source_channel_id=e.payload_meta->>'channel_id' and respond_contact_id=e.respond_contact_id and source_message_id=e.message_id);
  -- A losing request cannot hide a committed route or reopen a terminal review.
  if c.routing_state='pending' then
    update public.social_capture_receipts set routing_state='review_required',completed_at=clock_timestamp(),
      sqlstate=case when p_sqlstate in ('P0001','23505','23503','23514','42501','40001','40P01','55P03','57014','08006','PGRST202','PGRST205') then p_sqlstate end,
      reason=case when p_reason in ('invalid_message_identity','identity_read_failed','context_read_failed','reference_read_failed','capture_rpc_failed','context_conflict') then p_reason else 'capture_failed' end,
      stage=case when p_stage in ('transport','identity','context','reference','capture_rpc') then p_stage else 'capture_rpc' end,
      rpc_name=case p_stage when 'context' then 'read_social_route_context_v1' when 'capture_rpc' then 'capture_social_route_v1' end
      where source_event_id=c.source_event_id returning * into c;
  end if;
  return jsonb_build_object('state',c.routing_state,'reason',c.reason,'routeId',c.route_id);
end $$;

create or replace function public.capture_social_route_v1(p_route jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.social_message_routes%rowtype; target text; inserted_inbound uuid; hit boolean;
  head jsonb; previous_id uuid; previous_destination text; receipt public.social_capture_receipts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('social-context:'||coalesce(p_route->>'source_channel_id','')||':'||coalesce(p_route->>'respond_contact_id',''),0));
  perform pg_advisory_xact_lock(hashtextextended('social:'||coalesce(p_route->>'source_channel_id','')||':'||coalesce(p_route->>'respond_contact_id','')||':'||coalesce(p_route->>'source_message_id',''),0));
  select * into r from public.social_message_routes where source_event_id=p_route->>'source_event_id'
    or (source_channel_id=p_route->>'source_channel_id' and respond_contact_id=p_route->>'respond_contact_id' and source_message_id=p_route->>'source_message_id') limit 1;
  if found then
    if (r.respond_contact_id,r.source_channel_id,r.source_message_id) is distinct from
      (p_route->>'respond_contact_id',p_route->>'source_channel_id',p_route->>'source_message_id') then raise exception 'social_event_collision'; end if;
    update public.social_capture_receipts set route_id=r.id,
      routing_state=case when r.reason='late_message_requires_review' then 'review_required' else 'routed' end,
      reason=case when r.reason='late_message_requires_review' then r.reason end,completed_at=clock_timestamp()
      where routing_state='pending' and (source_event_id=p_route->>'source_event_id'
        or (source_channel_id=r.source_channel_id and respond_contact_id=r.respond_contact_id and source_message_id=r.source_message_id));
    return jsonb_build_object('created',false,'destination',r.destination,'routeId',r.id,'inboundId',r.inbound_id);
  end if;
  select * into receipt from public.social_capture_receipts where source_event_id=p_route->>'source_event_id'
    or (source_channel_id=p_route->>'source_channel_id' and respond_contact_id=p_route->>'respond_contact_id' and source_message_id=p_route->>'source_message_id');
  if found and receipt.routing_state='review_required' then
    return jsonb_build_object('created',false,'status','review_required');
  end if;
  head := public.read_social_route_context_v1(p_route->>'respond_contact_id',p_route->>'source_channel_id',(p_route->>'occurred_at')::timestamptz)->'current';
  previous_id := (head->>'id')::uuid; previous_destination := head->>'destination';
  if previous_id is distinct from (p_route->>'previous_route_id')::uuid then
    raise exception 'social_context_changed_requires_review';
  end if;
  -- A tardy message is durably reviewed, not sent out of sequence or allowed to
  -- overwrite the current intent. This is enforced here, not only by the caller.
  if (head->>'occurred_at')::timestamptz > (p_route->>'occurred_at')::timestamptz then
    p_route := p_route || jsonb_build_object('destination','HUMAN_REVIEW','reason','late_message_requires_review','sanitized_text','');
  end if;
  if previous_destination='OWNER' and p_route->>'destination' not in ('OWNER','HUMAN_REVIEW')
    and not (p_route->>'reason'='explicit_intent_change' or (p_route->>'destination'='UNKNOWN' and p_route->>'reason'='owner_explicit_closure')) then
    raise exception 'social_owner_transition_requires_explicit_evidence';
  end if;
  foreach target in array array['sales_agent_v2_inbound_messages','owner_agent_v1_inbound_messages','legal_agent_v1_inbound_messages'] loop
    execute format('select exists(select 1 from public.%I where event_id=$1 or (channel_id=$2 and respond_contact_id=$3 and external_message_id=$4))',target)
      into hit using p_route->>'source_event_id',p_route->>'source_channel_id',p_route->>'respond_contact_id',p_route->>'source_message_id';
    if hit then raise exception 'social_preexisting_legacy_message'; end if;
  end loop;
  inserted_inbound := case when p_route->>'destination' in ('SALES','OWNER','LEGAL') then gen_random_uuid() else null end;
  insert into public.social_message_routes(source_event_id,source_channel_id,source_message_id,respond_contact_id,source_platform,
    source_post_id,source_comment_id,source_ad_id,source_campaign_id,source_property_id,source_metadata,
    destination,reason,identity_status,canonical_identity_id,inbound_id,occurred_at,created_at)
  values(p_route->>'source_event_id',p_route->>'source_channel_id',p_route->>'source_message_id',p_route->>'respond_contact_id',p_route->>'source_platform',
    p_route->>'source_post_id',p_route->>'source_comment_id',p_route->>'source_ad_id',p_route->>'source_campaign_id',(p_route->>'source_property_id')::uuid,nullif(p_route->'source_metadata','null'::jsonb),
    p_route->>'destination',p_route->>'reason',p_route->>'identity_status',(p_route->>'canonical_identity_id')::uuid,inserted_inbound,(p_route->>'occurred_at')::timestamptz,clock_timestamp()) returning * into r;
  target := case r.destination when 'SALES' then 'sales_agent_v2_inbound_messages' when 'OWNER' then 'owner_agent_v1_inbound_messages' when 'LEGAL' then 'legal_agent_v1_inbound_messages' end;
  if target is not null then
    execute format('insert into public.%I(id,event_id,external_message_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status,debounce_until,social_route_id) values($1,$2,$3,$4,$5,$6,$7,''captured'',now()+interval ''4 seconds'',$8)',target)
      using inserted_inbound,r.source_event_id,r.source_message_id,r.respond_contact_id,r.source_channel_id,r.occurred_at,p_route->>'sanitized_text',r.id;
  end if;
  update public.social_capture_receipts set route_id=r.id,
    routing_state=case when r.reason='late_message_requires_review' then 'review_required' else 'routed' end,
    reason=case when r.reason='late_message_requires_review' then r.reason end,
    completed_at=clock_timestamp(),sqlstate=null,stage='capture_rpc',rpc_name='capture_social_route_v1'
    where source_event_id=receipt.source_event_id and routing_state='pending';
  return jsonb_build_object('created',true,'destination',r.destination,'routeId',r.id,'inboundId',r.inbound_id);
end $$;

revoke all on function public.seed_social_capture_receipt_v1() from public,anon,authenticated,service_role;
revoke all on function public.read_social_route_context_v1(text,text,timestamptz),public.begin_social_capture_v1(text),public.fail_social_capture_v1(text,text,text,text),public.capture_social_route_v1(jsonb) from public,anon,authenticated;
grant execute on function public.read_social_route_context_v1(text,text,timestamptz),public.begin_social_capture_v1(text),public.fail_social_capture_v1(text,text,text,text),public.capture_social_route_v1(jsonb) to service_role;
do $$ begin
  if has_table_privilege('anon','public.social_capture_receipts','SELECT')
    or has_table_privilege('authenticated','public.social_capture_receipts','SELECT')
    or has_function_privilege('authenticated','public.begin_social_capture_v1(text)','EXECUTE')
    or not (select relrowsecurity from pg_class where oid='public.social_capture_receipts'::regclass) then
    raise exception 'social_capture_acl_postcheck_failed';
  end if;
end $$;
commit;
