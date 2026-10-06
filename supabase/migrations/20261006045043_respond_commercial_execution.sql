begin;

-- Existing jobs are explicitly ineligible. No backfill/replay authority.
alter table public.respond_commercial_jobs add column execution_recovery boolean not null default false;
alter table public.respond_commercial_jobs alter column execution_recovery set default true;

create table public.respond_commercial_executions (
  inbound_id uuid primary key,
  event_id text not null unique references public.respond_commercial_jobs(event_id),
  route_id uuid not null unique references public.social_message_routes(id),
  lane text not null check(lane in ('SALES','OWNER','LEGAL')),
  respond_contact_id text not null,
  state text not null check(state in ('running','retryable','complete','paused','review_required')),
  phase text not null check(phase in ('claimed','model','effects')),
  attempts smallint not null check(attempts between 0 and 2),
  token uuid, lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  reason text check(reason in ('pre_model_failure','model_failed_no_effect','lease_expired_pre_model',
    'attempts_exhausted','execution_uncertain','existing_effect','human_attention_blocked','route_changed','inbound_terminal')),
  audit jsonb not null default '[]'::jsonb check(jsonb_typeof(audit)='array'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index respond_commercial_executions_ready_idx on public.respond_commercial_executions(next_attempt_at,created_at)
  where state in ('running','retryable');
alter table public.respond_commercial_executions enable row level security;
revoke all on public.respond_commercial_executions from public,anon,authenticated,service_role;
grant select on public.respond_commercial_executions to service_role;

-- Conservative: ANY run/outbound/handoff/reservation prevents another model,
-- not only sent rows. Never decide human authorship from these journals.
create function public.respond_execution_has_effect_v1(p_inbound uuid,p_route uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sales_agent_v2_shadow_runs where inbound_message_id=p_inbound)
 or exists(select 1 from public.owner_agent_v1_runs where inbound_message_id=p_inbound)
 or exists(select 1 from public.legal_agent_v1_runs where inbound_message_id=p_inbound)
 or exists(select 1 from public.sales_agent_v2_auto_outbound where inbound_message_id=p_inbound)
 or exists(select 1 from public.owner_agent_v1_auto_outbound where inbound_message_id=p_inbound)
 or exists(select 1 from public.legal_agent_v1_auto_outbound where inbound_message_id=p_inbound)
 or exists(select 1 from public.sales_agent_v2_handoffs where social_route_id=p_route)
 or exists(select 1 from public.legal_agent_v1_handoffs where social_route_id=p_route)
$$;

create function public.claim_respond_execution_v1(p_lane text,p_inbound uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='4s' as $$
declare r public.social_message_routes%rowtype; j public.respond_commercial_jobs%rowtype;
 e public.respond_commercial_executions%rowtype; i jsonb; target text; why text;
begin
 target:=case p_lane when 'SALES' then 'sales_agent_v2_inbound_messages' when 'OWNER' then 'owner_agent_v1_inbound_messages' when 'LEGAL' then 'legal_agent_v1_inbound_messages' end;
 if target is null then raise exception 'execution_invalid_lane'; end if;
 select * into r from public.social_message_routes where inbound_id=p_inbound and destination=p_lane;
 if not found then return jsonb_build_object('managed',false); end if;
 select * into j from public.respond_commercial_jobs where event_id=r.source_event_id and execution_recovery;
 if not found then return jsonb_build_object('managed',false); end if;
 if p_enabled is distinct from true then return jsonb_build_object('managed',true,'authorized',false,'state','disabled'); end if;
 -- Same ordering for every claimant. No model/network call inside a transaction.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('commercial-execution:'||p_inbound::text,0));
 execute format('select to_jsonb(i) from public.%I i where id=$1 for update',target) into i using p_inbound;
 if i is null or i->>'social_route_id' is distinct from r.id::text
   or i->>'respond_contact_id' is distinct from j.respond_contact_id
   or i->>'channel_id' is distinct from j.channel_id then raise exception 'execution_binding_invalid'; end if;
 select * into e from public.respond_commercial_executions where inbound_id=p_inbound for update;
 if not found then
   -- Never adopt an old in-flight/failed inbound, even if a caller asks.
   if i->>'status'<>'captured' then return jsonb_build_object('managed',true,'authorized',false,'state','not_claimed'); end if;
   insert into public.respond_commercial_executions(inbound_id,event_id,route_id,lane,respond_contact_id,state,phase,attempts)
     values(p_inbound,j.event_id,r.id,p_lane,j.respond_contact_id,'retryable','claimed',0) returning * into e;
 end if;
 if e.state not in ('running','retryable') or e.next_attempt_at>now()
   or (e.state='running' and e.lease_until>=now()) then
   return jsonb_build_object('managed',true,'authorized',false,'state','not_claimed'); end if;
 if e.state='running' and e.phase<>'claimed' then why:='execution_uncertain';
 elsif public.respond_execution_has_effect_v1(p_inbound,r.id) then why:='existing_effect';
 elsif i->>'status' not in ('captured','processing','failed') then why:='inbound_terminal';
 elsif (select id from public.social_message_routes where respond_contact_id=r.respond_contact_id and source_channel_id=r.source_channel_id
    order by occurred_at desc,created_at desc,id desc limit 1) is distinct from r.id then why:='route_changed';
 elsif (public.read_respond_human_pause_v1(r.respond_contact_id,r.occurred_at)->>'blocked')::boolean is distinct from false then why:='human_attention_blocked';
 elsif e.attempts>=2 then why:='attempts_exhausted'; end if;
 if why is not null then
   update public.respond_commercial_executions set state=case when why='human_attention_blocked' then 'paused' else 'review_required' end,
     reason=why,token=null,lease_until=null,updated_at=now(),audit=audit||jsonb_build_array(jsonb_build_object('at',now(),'reason',why,'attempt',attempts)) where inbound_id=p_inbound;
   if why='human_attention_blocked' then
     execute format('update public.%I set status=''skipped'' where id=$1 and status in (''captured'',''processing'',''failed'')',target) using p_inbound;
   end if;
   return jsonb_build_object('managed',true,'authorized',false,'state',case when why='human_attention_blocked' then 'paused' else 'review_required' end);
 end if;
 update public.respond_commercial_executions set state='running',phase='claimed',attempts=attempts+1,
   token=gen_random_uuid(),lease_until=now()+interval '180 seconds',reason=null,updated_at=now(),
   audit=audit||jsonb_build_array(jsonb_build_object('at',now(),'phase','claimed','attempt',attempts+1))
   where inbound_id=p_inbound returning * into e;
 -- This transition never resets to captured; #165 remains unchanged.
 execute format('update public.%I set status=''processing'' where id=$1 returning to_jsonb(%I)',target,target) into i using p_inbound;
 return jsonb_build_object('managed',true,'authorized',true,'token',e.token,'inbound',i);
end $$;

create function public.step_respond_execution_v1(p_inbound uuid,p_token uuid,p_action text,p_session_ref text default null)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='4s' as $$
declare e public.respond_commercial_executions%rowtype; r public.social_message_routes%rowtype;
 s text; why text; ph text;
begin
 if p_action is null or p_action not in ('model','tools','effects','verify','model_failed','error','complete')
   or (p_session_ref is not null and p_session_ref !~ '^[a-f0-9]{64}$') then raise exception 'execution_invalid_step'; end if;
 select * into e from public.respond_commercial_executions where inbound_id=p_inbound for update;
 if not found or e.state<>'running' or e.token is distinct from p_token then return jsonb_build_object('allowed',false,'state','lease_lost'); end if;
 select * into strict r from public.social_message_routes where id=e.route_id;
 s:=e.state; ph:=e.phase;
 if e.lease_until<now() then s:='review_required';why:='execution_uncertain';
 elsif p_action in ('model','tools','effects','verify') and
   (public.read_respond_human_pause_v1(r.respond_contact_id,r.occurred_at)->>'blocked')::boolean is distinct from false then
   s:='paused';why:='human_attention_blocked';
 elsif p_action in ('model','tools','effects','verify') and
   (select id from public.social_message_routes where respond_contact_id=r.respond_contact_id and source_channel_id=r.source_channel_id
     order by occurred_at desc,created_at desc,id desc limit 1) is distinct from r.id then s:='review_required';why:='route_changed';
 elsif p_action='model' and e.phase='claimed' then
   if public.respond_execution_has_effect_v1(p_inbound,e.route_id) then s:='review_required';why:='existing_effect'; else ph:='model'; end if;
 elsif p_action in ('tools','effects') then ph:='effects';
 elsif p_action='verify' and e.phase='effects' then null;
 elsif p_action='complete' then s:='complete';
 elsif p_action in ('model_failed','error') then
   if ((p_action='model_failed' and e.phase='model' and p_session_ref is not null) or (p_action='error' and e.phase='claimed'))
     and not public.respond_execution_has_effect_v1(p_inbound,e.route_id) then
     s:=case when e.attempts<2 then 'retryable' else 'review_required' end;
     why:=case when e.attempts>=2 then 'attempts_exhausted' when p_action='model_failed' then 'model_failed_no_effect' else 'pre_model_failure' end;
   else s:='review_required';why:='execution_uncertain'; end if;
 else s:='review_required';why:='execution_uncertain'; end if;
 update public.respond_commercial_executions set state=s,phase=ph,reason=why,updated_at=now(),
   token=case when s='running' then token else null end,lease_until=case when s='running' then lease_until else null end,
   next_attempt_at=case when s='retryable' then now()+interval '30 seconds' else next_attempt_at end,
   audit=audit||jsonb_build_array(jsonb_build_object('at',now(),'action',p_action,'phase',ph,'state',s,'reason',why,'attempt',attempts,'sessionRef',p_session_ref))
   where inbound_id=p_inbound;
 return jsonb_build_object('allowed',s in ('running','complete'),'state',s,'reason',why);
end $$;

-- DB clock avoids client skew/millisecond truncation. Selection is only a hint;
-- claim_respond_execution_v1 supplies the exclusive, fenced authorization.
create function public.next_respond_execution_v1()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('inbound_id',inbound_id,'lane',lane) from public.respond_commercial_executions
 where next_attempt_at<=now() and (state='retryable' or (state='running' and lease_until<now()))
 order by next_attempt_at,created_at,inbound_id limit 1
$$;
revoke all on function public.respond_execution_has_effect_v1(uuid,uuid),public.claim_respond_execution_v1(text,uuid,boolean),
 public.step_respond_execution_v1(uuid,uuid,text,text),public.next_respond_execution_v1() from public,anon,authenticated,service_role;
grant execute on function public.claim_respond_execution_v1(text,uuid,boolean),public.step_respond_execution_v1(uuid,uuid,text,text),public.next_respond_execution_v1() to service_role;
commit;
