-- Operator approval required. Never discard diagnostic evidence.
-- Prefer retaining schema/data and rolling back application only after review.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.gv_respond_webhook_events,public.social_capture_receipts in access exclusive mode;
do $$ begin
 if exists(select 1 from public.social_capture_receipts) then
   raise exception 'social_capture_rollback_refused_evidence_exists';
 end if;
end $$;
drop trigger social_capture_receipt_after_transport on public.gv_respond_webhook_events;
create or replace function public.capture_social_route_v1(p_route jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
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
drop function public.seed_social_capture_receipt_v1(),public.begin_social_capture_v1(text),public.fail_social_capture_v1(text,text,text,text),public.read_social_route_context_v1(text,text,timestamptz);
drop index public.social_route_head_idx;
drop table public.social_capture_receipts;
commit;
