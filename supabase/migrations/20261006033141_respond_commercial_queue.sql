begin;

-- No backfill. Snapshot completion is not commercial completion.
create table public.respond_commercial_jobs (
  event_id text primary key references public.gv_respond_webhook_events(event_id),
  respond_contact_id text not null,
  channel_id text not null check(channel_id in ('497382','497385','498219','515318')),
  message_id text not null,
  occurred_at timestamptz not null,
  envelope jsonb not null check(jsonb_typeof(envelope)='object' and octet_length(envelope::text)<=12000
    and envelope->>'version'='1' and length(envelope->>'text')<=2000),
  state text not null default 'pending' check(state in ('pending','processing','complete','review_required')),
  attempts integer not null default 0,
  claim_token uuid, lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  reason text check(reason in ('capture_unavailable','attempts_exhausted','capture_review','preexisting_transport_requires_review')),
  created_at timestamptz not null default now(), completed_at timestamptz,
  unique(channel_id,respond_contact_id,message_id)
);
create index respond_commercial_jobs_ready_idx on public.respond_commercial_jobs(next_attempt_at,created_at,event_id)
  where state in ('pending','processing');
create index respond_commercial_jobs_contact_idx on public.respond_commercial_jobs(respond_contact_id,channel_id,created_at,event_id)
  where state in ('pending','processing');
alter table public.respond_commercial_jobs enable row level security;
revoke all on public.respond_commercial_jobs from public,anon,authenticated,service_role;
grant select on public.respond_commercial_jobs to service_role;

create function public.enqueue_respond_commercial_v1(p_event jsonb,p_envelope jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='3s' set lock_timeout='2s' as $$
declare
  v_event public.gv_respond_webhook_events%rowtype;
  v_job public.respond_commercial_jobs%rowtype;
  v_new boolean; v_state text;
  v_id text:=p_event->>'event_id'; v_contact text:=p_event->>'respond_contact_id';
  v_channel text:=p_event->>'channel_id'; v_message text:=p_event->>'message_id';
begin
  if p_event->>'event_type' is distinct from 'message.received'
    or v_id is null or v_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
    or v_contact is null or v_contact !~ '^[A-Za-z0-9_.:-]{1,200}$'
    or v_message is null or v_message !~ '^[A-Za-z0-9_.:-]{1,200}$'
    or v_channel is null or v_channel not in ('497382','497385','498219','515318')
    or p_envelope->>'version' is distinct from '1'
    or jsonb_typeof(p_envelope->'text') is distinct from 'string'
    or jsonb_typeof(p_envelope->'references'->'publicIds') is distinct from 'array'
    then raise exception 'commercial_invalid_envelope'; end if;
  -- Same message, even when the provider supplies a different delivery ID.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    jsonb_build_array('respond-commercial',v_contact,v_channel,v_message)::text,0));
  insert into public.gv_respond_webhook_events(event_id,event_type,respond_contact_id,event_occurred_at,message_id,payload_meta)
    values(v_id,'message.received',v_contact,coalesce((p_event->>'event_occurred_at')::timestamptz,now()),v_message,
      coalesce(p_event->'payload_meta','{}'::jsonb)||jsonb_build_object('channel_id',v_channel,'social_capture_required',true))
    on conflict(event_id) do nothing;
  v_new:=found;
  select * into strict v_event from public.gv_respond_webhook_events where event_id=v_id;
  if v_event.event_type<>'message.received' or v_event.respond_contact_id<>v_contact
    or v_event.message_id is distinct from v_message or v_event.payload_meta->>'channel_id' is distinct from v_channel
    then raise exception 'commercial_event_identity_conflict'; end if;
  select * into v_job from public.respond_commercial_jobs
    where channel_id=v_channel and respond_contact_id=v_contact and message_id=v_message;
  if found then return jsonb_build_object('durable',true,'duplicate',true,'state',v_job.state); end if;
  -- Old delivery retries are not replay authority. Reuse a terminal receipt;
  -- an old transport without terminal capture is visible review, never dispatch.
  select routing_state into v_state from public.social_capture_receipts
    where source_channel_id=v_channel and respond_contact_id=v_contact and source_message_id=v_message;
  if v_state in ('routed','review_required') then
    return jsonb_build_object('durable',true,'duplicate',true,'state',v_state);
  end if;
  insert into public.respond_commercial_jobs(event_id,respond_contact_id,channel_id,message_id,occurred_at,envelope,state,reason)
    values(v_id,v_contact,v_channel,v_message,v_event.event_occurred_at,p_envelope,
      case when v_new then 'pending' else 'review_required' end,
      case when v_new then null else 'preexisting_transport_requires_review' end) returning * into v_job;
  return jsonb_build_object('durable',true,'duplicate',not v_new,'state',v_job.state);
end $$;

create function public.claim_respond_commercial_v1()
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='4s' as $$
declare v_job public.respond_commercial_jobs%rowtype;
begin
  select j.* into v_job from public.respond_commercial_jobs j
  where j.state in ('pending','processing') and j.next_attempt_at<=now()
    and (j.state='pending' or j.lease_until<now())
    -- SKIP LOCKED alone would let a second message overtake its conversation.
    and not exists(select 1 from public.respond_commercial_jobs p
      where p.respond_contact_id=j.respond_contact_id and p.channel_id=j.channel_id
        and p.state in ('pending','processing') and (p.created_at,p.event_id)<(j.created_at,j.event_id))
  order by j.created_at,j.event_id for update of j skip locked limit 1;
  if not found then return null; end if;
  update public.respond_commercial_jobs set state='processing',attempts=attempts+1,
    claim_token=gen_random_uuid(),lease_until=now()+interval '120 seconds'
    where event_id=v_job.event_id returning * into v_job;
  return to_jsonb(v_job);
end $$;

create function public.finish_respond_commercial_v1(p_event_id text,p_token uuid,p_state text)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='4s' as $$
declare v_job public.respond_commercial_jobs%rowtype; v_receipt text;
begin
  if p_state is null or p_state not in ('pending','complete','review_required') then raise exception 'commercial_invalid_finish'; end if;
  select * into v_job from public.respond_commercial_jobs where event_id=p_event_id for update;
  if not found or v_job.state<>'processing' or v_job.claim_token is distinct from p_token
    then return jsonb_build_object('state','lease_lost'); end if;
  select routing_state into v_receipt from public.social_capture_receipts where
    respond_contact_id=v_job.respond_contact_id and source_channel_id=v_job.channel_id and source_message_id=v_job.message_id;
  -- Receipt, not caller optimism, authorizes terminal completion.
  if v_receipt='routed' then p_state:='complete';
  elsif v_receipt='review_required' then p_state:='review_required';
  else p_state:='pending'; end if;
  if p_state='pending' and v_job.attempts>=5 then p_state:='review_required'; end if;
  update public.respond_commercial_jobs set state=p_state,claim_token=null,lease_until=null,
    next_attempt_at=now()+interval '30 seconds'*least(v_job.attempts,5),
    completed_at=case when p_state='pending' then null else now() end,
    reason=case when p_state='complete' then null when p_state='pending' then 'capture_unavailable'
      when v_receipt='review_required' then 'capture_review' else 'attempts_exhausted' end
    where event_id=p_event_id;
  return jsonb_build_object('state',p_state);
end $$;

revoke all on function public.enqueue_respond_commercial_v1(jsonb,jsonb),public.claim_respond_commercial_v1(),
  public.finish_respond_commercial_v1(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_respond_commercial_v1(jsonb,jsonb),public.claim_respond_commercial_v1(),
  public.finish_respond_commercial_v1(text,uuid,text) to service_role;
commit;
