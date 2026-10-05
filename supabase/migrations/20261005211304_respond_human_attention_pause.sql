begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- The signed Respond transport ledger is the durable pause source. Do not copy
-- message text, infer authorship from assignment, or overwrite snapshot state.
-- A verified conversation.closed ends an episode. Neither inbound nor routing
-- nor conversation.opened alone clears human control in that episode.
create table public.respond_ai_resumptions (
  human_event_id text primary key references public.gv_respond_webhook_events(event_id) on delete restrict,
  respond_contact_id text not null,
  episode_key text not null,
  resumed_by uuid not null references public.profiles(id) on delete restrict,
  resumed_at timestamptz not null default clock_timestamp()
);
alter table public.respond_ai_resumptions enable row level security;
revoke all on public.respond_ai_resumptions from public, anon, authenticated;
grant select, insert on public.respond_ai_resumptions to service_role;
create index respond_human_attention_events_idx on public.gv_respond_webhook_events
  (respond_contact_id, received_at desc, event_id desc)
  where event_type = 'conversation.closed' or (event_type = 'message.sent' and payload_meta->>'sender_source' = 'user');

create function public.read_respond_human_pause_v1(p_contact_id text, p_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.gv_respond_webhook_events%rowtype;
  h public.gv_respond_webhook_events%rowtype; episode text; resumed timestamptz;
begin
  if nullif(btrim(p_contact_id),'') is null or p_at is null then
    return jsonb_build_object('blocked',true,'reason','human_attention_scope_unknown');
  end if;
  select * into c from public.gv_respond_webhook_events
    where respond_contact_id=p_contact_id and event_type='conversation.closed'
      and event_occurred_at <= clock_timestamp()
    order by event_occurred_at desc, event_id collate "C" desc limit 1;
  episode := coalesce(c.event_id,'initial');
  if c.event_id is not null and p_at <= c.event_occurred_at then
    return jsonb_build_object('blocked',true,'reason','human_attention_inactive_episode','episodeKey',episode);
  end if;
  select * into h from public.gv_respond_webhook_events e
    where e.respond_contact_id=p_contact_id and e.event_type='message.sent'
      and e.payload_meta->>'sender_source'='user'
      -- Missing time is ambiguous, never silently treated as historical.
      and (e.event_occurred_at is null or c.event_id is null or e.event_occurred_at > c.event_occurred_at)
    order by e.received_at desc, e.event_id collate "C" desc limit 1;
  select r.resumed_at into resumed from public.respond_ai_resumptions r
    where r.human_event_id=h.event_id and r.respond_contact_id=p_contact_id and r.episode_key=episode;
  if h.event_id is not null and resumed is null then
    return jsonb_build_object('blocked',true,'reason','human_attention_active','episodeKey',episode,'humanEventId',h.event_id);
  end if;
  -- Returning control authorizes NEW turns only, never an old pending proposal.
  if resumed is not null and p_at <= resumed then
    return jsonb_build_object('blocked',true,'reason','human_attention_pre_resume','episodeKey',episode,'humanEventId',h.event_id);
  end if;
  return jsonb_build_object('blocked',false,'reason',null,'episodeKey',episode,'humanEventId',h.event_id);
end $$;

-- Serialize receipt ingestion with the final local dispatch boundary. A send
-- that already crossed this boundary is in flight/uncertain, NOT cancellable.
create function public.pause_sales_on_respond_human_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.event_type='message.sent' and new.payload_meta->>'sender_source'='user' then
    perform pg_advisory_xact_lock(hashtextextended('respond-human:'||new.respond_contact_id,0));
    update public.sales_agent_v2_auto_outbound o
      set status='blocked', error_code='human_attention_active', completed_at=clock_timestamp()
      from public.sales_agent_v2_inbound_messages i
      where i.id=o.inbound_message_id and o.respond_contact_id=new.respond_contact_id
        and o.status='processing' and o.error_code='human_guard_pending'
        and (public.read_respond_human_pause_v1(new.respond_contact_id,i.occurred_at)->>'blocked')::boolean;
  end if;
  return new;
end $$;
create trigger respond_human_attention_received after insert on public.gv_respond_webhook_events
  for each row execute function public.pause_sales_on_respond_human_v1();

create function public.begin_sales_human_guarded_send_v1(p_outbound_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare o public.sales_agent_v2_auto_outbound%rowtype; t timestamptz; gate jsonb;
begin
  select * into o from public.sales_agent_v2_auto_outbound where id=p_outbound_id;
  if not found then return jsonb_build_object('allowed',false,'reason','outbound_not_pending'); end if;
  perform pg_advisory_xact_lock(hashtextextended('respond-human:'||o.respond_contact_id,0));
  select * into o from public.sales_agent_v2_auto_outbound where id=p_outbound_id for update;
  if o.status<>'processing' or o.error_code is distinct from 'human_guard_pending' then
    return jsonb_build_object('allowed',false,'reason',case when o.error_code='human_attention_active' then o.error_code else 'outbound_not_pending' end);
  end if;
  select occurred_at into t from public.sales_agent_v2_inbound_messages where id=o.inbound_message_id;
  gate := public.read_respond_human_pause_v1(o.respond_contact_id,t);
  if (gate->>'blocked')::boolean then
    update public.sales_agent_v2_auto_outbound set status='blocked',error_code=gate->>'reason',completed_at=clock_timestamp() where id=o.id;
    return jsonb_build_object('allowed',false,'reason',gate->>'reason');
  end if;
  update public.sales_agent_v2_auto_outbound set error_code='dispatch_started' where id=o.id;
  return jsonb_build_object('allowed',true);
end $$;

-- Explicit return to AI only. Authentication/role authority is checked here,
-- not derived from Respond assignee. CAS prevents a stale UI from resuming a
-- newer human intervention. No queue reset or historical resend is performed.
create function public.resume_respond_ai_v1(p_contact_id text,p_episode_key text,p_human_event_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); gate jsonb;
begin
  if actor is null or not exists(select 1 from public.profiles where id=actor and active=true and role_id in ('admin','gerente_ventas')) then
    raise exception 'human_attention_resume_forbidden' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('respond-human:'||p_contact_id,0));
  gate := public.read_respond_human_pause_v1(p_contact_id,clock_timestamp());
  if gate->>'episodeKey' is distinct from p_episode_key or gate->>'humanEventId' is distinct from p_human_event_id or p_human_event_id is null then
    raise exception 'human_attention_changed' using errcode='40001';
  end if;
  insert into public.respond_ai_resumptions(human_event_id,respond_contact_id,episode_key,resumed_by)
    values(p_human_event_id,p_contact_id,p_episode_key,actor) on conflict(human_event_id) do nothing;
  return jsonb_build_object('resumed',true,'episodeKey',p_episode_key);
end $$;

revoke all on function public.read_respond_human_pause_v1(text,timestamptz),
 public.pause_sales_on_respond_human_v1(), public.begin_sales_human_guarded_send_v1(uuid),
 public.resume_respond_ai_v1(text,text,text) from public,anon,authenticated;
grant execute on function public.read_respond_human_pause_v1(text,timestamptz),
 public.pause_sales_on_respond_human_v1(), public.begin_sales_human_guarded_send_v1(uuid) to service_role;
grant execute on function public.resume_respond_ai_v1(text,text,text) to authenticated;
commit;
