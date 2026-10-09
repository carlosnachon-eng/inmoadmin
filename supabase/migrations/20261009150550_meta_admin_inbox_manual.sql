-- LOCAL REVIEW draft. No remote installation. No global defaults changed.
-- Conversation-wide pause: no resume, reset, reclaim, retry or delete RPC.
begin;
create table meta_admin_private.manual_actions (
 action_id uuid primary key,
 input_id uuid not null references meta_admin_private.inbound_inputs(id),
 actor_id uuid not null references public.profiles(id),
 sender_source text not null default 'inmoadmin_authenticated_operator' check(sender_source='inmoadmin_authenticated_operator'),
 token uuid not null unique,
 waba_id text not null check(waba_id='1297760461811288'),
 phone_number_id text not null check(phone_number_id='1198305790026665'),
 subject_ref text not null,
 key_tag text not null,
 sanitized_text text not null check(length(btrim(sanitized_text)) between 1 and 2000),
 created_at timestamptz not null default clock_timestamp()
);
create index manual_actions_subject on meta_admin_private.manual_actions(waba_id,phone_number_id,subject_ref,key_tag,created_at);
create table meta_admin_private.manual_events (
 action_id uuid not null references meta_admin_private.manual_actions(action_id),
 phase text not null check(phase in ('dispatch_started','outcome')),
 status text not null check(status in ('dispatch_started','accepted','failed','uncertain')),
 native_wamid text unique,
 occurred_at timestamptz not null default clock_timestamp(),
 primary key(action_id,phase),
 check((phase='dispatch_started' and status='dispatch_started' and native_wamid is null)
   or (phase='outcome' and status in ('accepted','failed','uncertain'))),
 check((status='accepted' and native_wamid is not null and length(native_wamid)<=506 and native_wamid ~ '^wamid\.[A-Za-z0-9+/=_-]+$')
   or (status<>'accepted' and native_wamid is null))
);
create table meta_admin_private.manual_attention (
 action_id uuid primary key references meta_admin_private.manual_actions(action_id),
 paused boolean not null default true check(paused),
 reason text not null default 'human_manual_reply' check(reason='human_manual_reply'),
 paused_by uuid not null references public.profiles(id),
 paused_at timestamptz not null default clock_timestamp()
);
alter table meta_admin_private.manual_actions enable row level security;
alter table meta_admin_private.manual_events enable row level security;
alter table meta_admin_private.manual_attention enable row level security;
revoke all on meta_admin_private.manual_actions,meta_admin_private.manual_events,meta_admin_private.manual_attention from public,anon,authenticated,service_role;
create function meta_admin_private.manual_immutable_v1() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'manual_history_immutable';end $$;
create trigger manual_actions_immutable before update or delete on meta_admin_private.manual_actions for each row execute function meta_admin_private.manual_immutable_v1();
create trigger manual_events_immutable before update or delete on meta_admin_private.manual_events for each row execute function meta_admin_private.manual_immutable_v1();
create trigger manual_attention_immutable before update or delete on meta_admin_private.manual_attention for each row execute function meta_admin_private.manual_immutable_v1();

-- Exact evidence only. Human replies do NOT require canonical matched identity.
-- Unknown provenance is denied; unmatched with a verified Meta subject is allowed.
create function public.meta_admin_manual_load_v1(p_input_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare evidence jsonb; result jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and active and role_id in ('admin','coord_operaciones')) then return null;end if;
 evidence:=public.meta_admin_memory_evidence_v1(p_input_id);
 if evidence->>'native_verified' is distinct from 'true' or evidence->>'scope_verified' is distinct from 'true'
   or evidence->>'audience' is null or evidence->>'audience' not in ('external_verified','unknown') then return null;end if;
 select jsonb_build_object('input',jsonb_build_object('id',i.id,'waba_id',i.waba_id,'phone_number_id',i.phone_number_id,
   'subject_ref',i.sender_ref,'key_tag',se.key_tag,'native_message_id',i.native_message_id),
   'sender_ciphertext',i.sender_ciphertext,'sender_ref',i.sender_ref,'exact_phone_digest',i.exact_phone_digest,
   'sender_evidence',i.sender_evidence,'event_key',m.event_key) into result
 from meta_admin_private.inbound_inputs i join public.meta_observer_events m on m.id=i.meta_observer_event_id
 join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 join public.meta_observer_admin_scope s on s.waba_id=i.waba_id and s.phone_number_id=i.phone_number_id
 where i.id=p_input_id and s.enabled and s.respond_channel_id='544519'
 and i.waba_id='1297760461811288' and i.phone_number_id='1198305790026665'
 and m.waba_id=i.waba_id and m.phone_number_id=i.phone_number_id and m.native_message_id=i.native_message_id
 and m.category='inbound' and m.source_field='messages' and m.event_type='message.received'
 and m.observer_only and m.state='observed' and cardinality(m.error_codes)=0
 and i.occurred_at>clock_timestamp()-interval '24 hours' and i.occurred_at<=clock_timestamp()
 and se.evidence_state='exact' and se.evidence_source in ('signed_from','signed_from_and_wa_id')
 and se.subject_ref=i.sender_ref and se.subject_ref=evidence->>'subject_ref' and se.key_tag=evidence->>'key_tag'
 and not exists(select 1 from public.meta_observer_events x where x.waba_id=i.waba_id and x.phone_number_id=i.phone_number_id
   and x.original_message_id=i.native_message_id and x.event_type in ('message.edit','message.revoke'));
 return result;
end $$;

-- Stable fixed-scope pause reader. Does not disclose text, recipient or identity.
create function public.meta_admin_manual_attention_v1(p_input_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from meta_admin_private.inbound_inputs i
 join meta_admin_private.native_subject_evidence s on s.meta_observer_event_id=i.meta_observer_event_id
 join meta_admin_private.manual_actions a on a.waba_id=i.waba_id and a.phone_number_id=i.phone_number_id
   and a.subject_ref=i.sender_ref and a.key_tag=s.key_tag
 join meta_admin_private.manual_attention p on p.action_id=a.action_id and p.paused
 where i.id=p_input_id)
$$;

create function public.meta_admin_manual_reserve_v1(p_input_id uuid,p_actor_id uuid,p_action_id uuid,p_token uuid,p_text text) returns boolean
language plpgsql security definer set search_path='' as $$
declare e jsonb;
begin
 if p_action_id is null or p_token is null or p_text is null or length(p_text) not between 1 and 2000
   or p_text<>btrim(p_text) or p_text ~ '[<>]' or regexp_replace(p_text,E'[\n\r\t]','','g') ~ '[[:cntrl:]]'
   or p_text ~ U&'[\202A-\202E\2066-\2069]' then return false;end if;
 e:=public.meta_admin_manual_load_v1(p_input_id,p_actor_id);if e is null then return false;end if;
 -- Shared lock with AI start interlock. This is not a lease and is never reclaimed.
 perform pg_advisory_xact_lock(hashtextextended((e->'input'->>'subject_ref')||':'||(e->'input'->>'key_tag'),0));
 -- Never race a previously dispatched/in-doubt AI effect. Do not call it canceled.
 if exists(select 1 from meta_admin_private.controlled_outbound_runs r
   join meta_admin_private.inbound_inputs i on i.id=r.input_id
   join meta_admin_private.native_subject_evidence s on s.meta_observer_event_id=i.meta_observer_event_id
   where i.waba_id='1297760461811288' and i.phone_number_id='1198305790026665'
   and i.sender_ref=e->'input'->>'subject_ref' and s.key_tag=e->'input'->>'key_tag'
   and r.status in ('dispatch_started','uncertain')) then return false;end if;
 insert into meta_admin_private.manual_actions(action_id,input_id,actor_id,token,waba_id,phone_number_id,subject_ref,key_tag,sanitized_text)
 values(p_action_id,p_input_id,p_actor_id,p_token,'1297760461811288','1198305790026665',e->'input'->>'subject_ref',e->'input'->>'key_tag',p_text)
 on conflict do nothing;
 if not found then return false;end if;
 insert into meta_admin_private.manual_attention(action_id,paused_by) values(p_action_id,p_actor_id);
 return true;
end $$;

create function public.meta_admin_manual_start_v1(p_action_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare a meta_admin_private.manual_actions; e jsonb;
begin
 select * into a from meta_admin_private.manual_actions where action_id=p_action_id and token=p_token;
 if not found then return false;end if;
 e:=public.meta_admin_manual_load_v1(a.input_id,a.actor_id);
 if e is null or e->'input'->>'subject_ref' is distinct from a.subject_ref or e->'input'->>'key_tag' is distinct from a.key_tag then return false;end if;
 if not exists(select 1 from meta_admin_private.manual_attention where action_id=p_action_id and paused) then return false;end if;
 insert into meta_admin_private.manual_events(action_id,phase,status) values(p_action_id,'dispatch_started','dispatch_started') on conflict do nothing;
 return found;
end $$;
create function public.meta_admin_manual_finish_v1(p_action_id uuid,p_token uuid,p_status text,p_wamid text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_status is null or p_status not in ('accepted','failed','uncertain')
   or not exists(select 1 from meta_admin_private.manual_actions where action_id=p_action_id and token=p_token)
   or not exists(select 1 from meta_admin_private.manual_events where action_id=p_action_id and phase='dispatch_started') then return false;end if;
 if (p_status='accepted' and (p_wamid is null or length(p_wamid)>506 or p_wamid !~ '^wamid\.[A-Za-z0-9+/=_-]+$'))
   or (p_status<>'accepted' and p_wamid is not null) then return false;end if;
 insert into meta_admin_private.manual_events(action_id,phase,status,native_wamid) values(p_action_id,'outcome',p_status,p_wamid) on conflict do nothing;
 return found;
end $$;

-- Delivery projection of durable signed observer receipts, NOT inferred delivery.
-- Out-of-order statuses never regress read->delivered; contradictions remain visible.
create function public.meta_admin_manual_status_v1(p_input_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; subject text; tag text; evidence jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and active and role_id in ('admin','coord_operaciones')) then return null;end if;
 evidence:=public.meta_admin_memory_evidence_v1(p_input_id);
 if evidence->>'native_verified' is distinct from 'true' or evidence->>'scope_verified' is distinct from 'true'
   or evidence->>'audience' is null or evidence->>'audience' not in ('external_verified','unknown') then return null;end if;
 subject:=evidence->>'subject_ref';tag:=evidence->>'key_tag';
 select coalesce(jsonb_agg(x order by x.created_at),'[]'::jsonb) into result from (
  select a.action_id,a.created_at,a.sanitized_text as text,'human_confirmed' as provenance,
    d.occurred_at as dispatch_at,f.occurred_at as outcome_at,
    receipts.sent_at,receipts.delivered_at,receipts.read_at,receipts.failed_at,
    coalesce(f.status,case when d.action_id is not null then 'uncertain' else 'reserved' end) as attempt_status,
    case when coalesce(receipts.failed,false) and (coalesce(receipts.delivered,false) or coalesce(receipts.read,false)) then 'uncertain'
      when receipts.read then 'read' when receipts.delivered then 'delivered' when receipts.failed then 'failed'
      when receipts.sent then 'sent' else coalesce(f.status,case when d.action_id is not null then 'uncertain' else 'reserved' end) end as status,
    coalesce(receipts.failed,false) and (coalesce(receipts.delivered,false) or coalesce(receipts.read,false)) as contradictory
  from meta_admin_private.manual_actions a
  left join meta_admin_private.manual_events f on f.action_id=a.action_id and f.phase='outcome'
  left join meta_admin_private.manual_events d on d.action_id=a.action_id and d.phase='dispatch_started'
  left join lateral (select bool_or(m.status='sent') sent,bool_or(m.status='delivered') delivered,
    bool_or(m.status='read') read,bool_or(m.status='failed') failed,
    min(m.occurred_at) filter(where m.status='sent') sent_at,
    min(m.occurred_at) filter(where m.status='delivered') delivered_at,
    min(m.occurred_at) filter(where m.status='read') read_at,
    min(m.occurred_at) filter(where m.status='failed') failed_at from public.meta_observer_events m
    where m.waba_id=a.waba_id and m.phone_number_id=a.phone_number_id and m.native_message_id=f.native_wamid
    and m.category='status' and m.source_field='messages' and m.state='observed' and m.observer_only) receipts on true
  where a.waba_id='1297760461811288' and a.phone_number_id='1198305790026665' and a.subject_ref=subject and a.key_tag=tag
  order by a.created_at desc limit 50
 ) x;
 return jsonb_build_object('paused',public.meta_admin_manual_attention_v1(p_input_id),'messages',result);
end $$;

-- Durable interlock covers existing AI runtime/RPCs without any Respond/#168 change.
create function meta_admin_private.manual_ai_interlock_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare subject text;tag text;
begin
 select i.sender_ref,s.key_tag into subject,tag from meta_admin_private.inbound_inputs i
 join meta_admin_private.native_subject_evidence s on s.meta_observer_event_id=i.meta_observer_event_id where i.id=new.input_id;
 if subject is null or tag is null then raise exception 'meta_subject_unverified';end if;
 perform pg_advisory_xact_lock(hashtextextended(subject||':'||tag,0));
 if public.meta_admin_manual_attention_v1(new.input_id) then raise exception 'meta_manual_attention_active';end if;
 return new;
end $$;
create trigger manual_pause_shadow_start before update on meta_admin_private.shadow_once_runs for each row
 when (new.model_calls>old.model_calls or new.media_model_calls>old.media_model_calls)
 execute function meta_admin_private.manual_ai_interlock_v1();
create trigger manual_pause_ai_dispatch before update on meta_admin_private.controlled_outbound_runs for each row
 when (new.send_calls>old.send_calls) execute function meta_admin_private.manual_ai_interlock_v1();

revoke all on function meta_admin_private.manual_immutable_v1(),meta_admin_private.manual_ai_interlock_v1() from public,anon,authenticated,service_role;
revoke all on function public.meta_admin_manual_load_v1(uuid,uuid),public.meta_admin_manual_attention_v1(uuid),
 public.meta_admin_manual_reserve_v1(uuid,uuid,uuid,uuid,text),public.meta_admin_manual_start_v1(uuid,uuid),
 public.meta_admin_manual_finish_v1(uuid,uuid,text,text),public.meta_admin_manual_status_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_manual_load_v1(uuid,uuid),public.meta_admin_manual_attention_v1(uuid),
 public.meta_admin_manual_reserve_v1(uuid,uuid,uuid,uuid,text),public.meta_admin_manual_start_v1(uuid,uuid),
 public.meta_admin_manual_finish_v1(uuid,uuid,text,text),public.meta_admin_manual_status_v1(uuid,uuid) to service_role;
commit;
