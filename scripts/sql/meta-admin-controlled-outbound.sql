-- Additive REVIEW proposal. No production install/activation. No source changes.
begin;
create table meta_admin_private.controlled_outbound_runs (
 input_id uuid primary key references meta_admin_private.inbound_inputs(id),
 waba_id text not null check(waba_id='1297760461811288'),
 phone_number_id text not null check(phone_number_id='1198305790026665'),
 inbound_wamid text not null,
 token uuid unique,
 input_fingerprint text,
 proposal_hash text,
 context_hash text,
 pilot_slot integer unique check(pilot_slot=1),
 status text not null check(status in ('reserved','dispatch_started','accepted','failed','uncertain','review_required')),
 reason text not null check(reason ~ '^[a-z0-9_]{1,100}$'),
 send_calls integer not null default 0 check(send_calls between 0 and 1),
 outbound_wamid text unique,
 created_at timestamptz not null default clock_timestamp(),
 dispatch_at timestamptz,
 finished_at timestamptz,
 unique(waba_id,phone_number_id,inbound_wamid),
 check(status='review_required' or (token is not null and pilot_slot=1 and input_fingerprint ~ '^[a-f0-9]{64}$'
   and proposal_hash ~ '^[a-f0-9]{64}$' and context_hash ~ '^[a-f0-9]{64}$')),
 check((send_calls=0 and status in ('reserved','review_required') and dispatch_at is null)
    or (send_calls=1 and status in ('dispatch_started','accepted','failed','uncertain') and dispatch_at is not null)),
 check((status='accepted' and outbound_wamid is not null and length(outbound_wamid)<=506 and outbound_wamid ~ '^wamid\.[A-Za-z0-9+/=_-]+$') or (status<>'accepted' and outbound_wamid is null))
);
alter table meta_admin_private.controlled_outbound_runs enable row level security;
revoke all on meta_admin_private.controlled_outbound_runs from public,anon,authenticated,service_role;

create function public.meta_admin_outbound_load_v1(p_input_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('sender_ciphertext',i.sender_ciphertext,'sender_ref',i.sender_ref,
 'exact_phone_digest',i.exact_phone_digest,'sender_evidence',i.sender_evidence,'event_key',m.event_key,
 'shadow',jsonb_build_object('status',s.status,'identity_state',s.identity_state,'provider',s.provider,'model',s.model,
 'model_calls',s.model_calls,'send_calls',s.send_calls,'input_fingerprint',s.input_fingerprint,'proposed_response',s.proposed_response))
 from meta_admin_private.inbound_inputs i join public.meta_observer_events m on m.id=i.meta_observer_event_id
 join meta_admin_private.shadow_once_runs s on s.input_id=i.id
 where i.id=p_input_id and i.waba_id='1297760461811288' and i.phone_number_id='1198305790026665'
$$;

create function public.meta_admin_outbound_reserve_v1(p_input_id uuid,p_token uuid,p_fingerprint text,p_proposal_hash text,p_context_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_token is null or p_fingerprint is null or p_proposal_hash is null or p_context_hash is null
   or p_fingerprint !~ '^[a-f0-9]{64}$' or p_proposal_hash !~ '^[a-f0-9]{64}$' or p_context_hash !~ '^[a-f0-9]{64}$' then return false;end if;
 insert into meta_admin_private.controlled_outbound_runs(input_id,waba_id,phone_number_id,inbound_wamid,token,input_fingerprint,proposal_hash,context_hash,pilot_slot,status,reason)
 select i.id,i.waba_id,i.phone_number_id,i.native_message_id,p_token,p_fingerprint,p_proposal_hash,p_context_hash,1,'reserved','pilot_reserved'
 from meta_admin_private.inbound_inputs i join meta_admin_private.shadow_once_runs s on s.input_id=i.id
 where i.id=p_input_id and i.waba_id='1297760461811288' and i.phone_number_id='1198305790026665'
 and i.occurred_at>clock_timestamp()-interval '24 hours' and i.occurred_at<=clock_timestamp()
 and s.status='complete' and s.identity_state='matched' and s.provider='openai' and s.model_calls=1 and s.send_calls=0
 and s.input_fingerprint=p_fingerprint and encode(sha256(convert_to(s.proposed_response,'UTF8')),'hex')=p_proposal_hash
 on conflict do nothing;
 return found;
end $$;

create function public.meta_admin_outbound_start_v1(p_input_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update meta_admin_private.controlled_outbound_runs set status='dispatch_started',reason='dispatch_reserved',send_calls=1,dispatch_at=clock_timestamp()
 where input_id=p_input_id and token=p_token and status='reserved' and send_calls=0;
 return found;
end $$;

create function public.meta_admin_outbound_finish_v1(p_input_id uuid,p_token uuid,p_status text,p_wamid text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_status is null or p_status not in ('accepted','failed','uncertain','review_required') then return false;end if;
 if (p_status='accepted' and (p_wamid is null or length(p_wamid)>506 or p_wamid !~ '^wamid\.[A-Za-z0-9+/=_-]+$'))
 or (p_status<>'accepted' and p_wamid is not null) then return false;end if;
 update meta_admin_private.controlled_outbound_runs set status=p_status,reason='attempt_terminal',outbound_wamid=p_wamid,finished_at=clock_timestamp()
 where input_id=p_input_id and token=p_token and ((status='reserved' and p_status='review_required')
 or (status='dispatch_started' and p_status in ('accepted','failed','uncertain')));
 return found;
end $$;

create function public.meta_admin_outbound_review_v1(p_input_id uuid,p_reason text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_reason is null or p_reason not in ('pre_dispatch_gate_failed') then return false;end if;
 insert into meta_admin_private.controlled_outbound_runs(input_id,waba_id,phone_number_id,inbound_wamid,status,reason,finished_at)
 select id,waba_id,phone_number_id,native_message_id,'review_required',p_reason,clock_timestamp()
 from meta_admin_private.inbound_inputs where id=p_input_id and waba_id='1297760461811288' and phone_number_id='1198305790026665'
 on conflict do nothing;
 return found;
end $$;

-- Read-only receipt evidence. No inferred human identity, no temporal matching,
-- no fabricated delivered/read, no status event causes another send.
create function public.meta_admin_outbound_status_v1(p_input_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('status',r.status,'send_calls',r.send_calls,
 'sent',coalesce(bool_or(m.status='sent'),false),'delivered',coalesce(bool_or(m.status='delivered'),false),
 'read',coalesce(bool_or(m.status='read'),false),'failed',r.status='failed' or coalesce(bool_or(m.status='failed'),false),
 'contradictory',coalesce(bool_or(m.status='failed') and bool_or(m.status in ('delivered','read')),false))
 from meta_admin_private.controlled_outbound_runs r left join public.meta_observer_events m
 on m.native_message_id=r.outbound_wamid and m.waba_id=r.waba_id and m.phone_number_id=r.phone_number_id
 and m.category='status' and m.state='observed' and m.observer_only
 where r.input_id=p_input_id group by r.input_id
$$;

revoke all on function public.meta_admin_outbound_load_v1(uuid),public.meta_admin_outbound_reserve_v1(uuid,uuid,text,text,text),
public.meta_admin_outbound_start_v1(uuid,uuid),public.meta_admin_outbound_finish_v1(uuid,uuid,text,text),
public.meta_admin_outbound_review_v1(uuid,text),public.meta_admin_outbound_status_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_outbound_load_v1(uuid),public.meta_admin_outbound_reserve_v1(uuid,uuid,text,text,text),
public.meta_admin_outbound_start_v1(uuid,uuid),public.meta_admin_outbound_finish_v1(uuid,uuid,text,text),
public.meta_admin_outbound_review_v1(uuid,text),public.meta_admin_outbound_status_v1(uuid) to service_role;
commit;
