begin;

-- Additive private evidence only. No source table/function/trigger alterations.
-- Installation watermark prevents historical hydration, including old retries.
create table meta_admin_private.subject_evidence_epoch (
  singleton boolean primary key default true check(singleton),
  not_before timestamptz not null default clock_timestamp()
);
insert into meta_admin_private.subject_evidence_epoch default values;

create table meta_admin_private.native_subject_evidence (
  meta_observer_event_id uuid primary key references public.meta_observer_events(id),
  subject_ref text check(subject_ref ~ '^[a-f0-9]{64}$'),
  key_tag text not null check(key_tag ~ '^[a-f0-9]{64}$'),
  context_id text check(length(context_id) between 7 and 506 and context_id ~ '^wamid\.[A-Za-z0-9+/=_-]+$'),
  evidence_state text not null check(evidence_state in ('exact','unknown')),
  evidence_source text not null check(evidence_source in ('signed_from','signed_to','no_recipient')),
  created_at timestamptz not null default clock_timestamp(),
  check((evidence_source='no_recipient' and subject_ref is null) or
        (evidence_source in ('signed_from','signed_to') and subject_ref is not null))
);

create function meta_admin_private.guard_subject_evidence_v1() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.meta_observer_events m
    join public.meta_observer_admin_scope s using(waba_id,phone_number_id)
    join meta_admin_private.capture_config c using(waba_id,phone_number_id)
    cross join meta_admin_private.subject_evidence_epoch epoch
    where m.id=new.meta_observer_event_id and m.waba_id='1297760461811288'
      and m.phone_number_id='1198305790026665' and s.respond_channel_id='544519'
      and s.enabled and c.enabled and m.observer_only and m.state='observed'
      and m.xmin=pg_current_xact_id()::xid and m.received_at>=statement_timestamp()
      and m.occurred_at>=greatest(c.not_before,epoch.not_before)
      and m.occurred_at<=clock_timestamp()+interval '5 minutes'
      and ((m.category='app_echo' and m.source_field='smb_message_echoes' and new.evidence_source<>'signed_from')
        or (m.category='inbound' and m.event_type='message.received' and new.evidence_source='signed_from'
          and new.context_id is null and new.evidence_state='exact' and exists(
            select 1 from meta_admin_private.inbound_inputs i where i.meta_observer_event_id=m.id
              and i.sender_ref=new.subject_ref)))) then
    raise exception using errcode='23514',message='meta_subject_not_future_eligible';
  end if;
  return new;
end $$;
create trigger meta_subject_evidence_guard before insert on meta_admin_private.native_subject_evidence
  for each row execute function meta_admin_private.guard_subject_evidence_v1();

create function public.capture_meta_admin_shadow_subject_v1(p_waba_id text,p_phone_number_id text,
  p_body_sha256 text,p_events jsonb,p_not_before timestamptz,p_inputs jsonb,p_subjects jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; item jsonb; m public.meta_observer_events%rowtype;
  epoch timestamptz; inserted_subjects integer:=0;
begin
  if p_waba_id is distinct from '1297760461811288' or p_phone_number_id is distinct from '1198305790026665'
    or p_subjects is null or jsonb_typeof(p_subjects)<>'array' or jsonb_array_length(p_subjects)>100 then
    raise exception using errcode='23514',message='meta_subject_scope_or_payload_invalid';
  end if;
  select not_before into strict epoch from meta_admin_private.subject_evidence_epoch where singleton;
  -- Existing RPC owns the exclusive scope lock. All observer/input/evidence
  -- writes share this transaction: a failure cannot ACK partial persistence.
  result:=public.capture_meta_admin_shadow_v1(p_waba_id,p_phone_number_id,p_body_sha256,p_events,p_not_before,p_inputs);
  for item in select x from jsonb_array_elements(p_subjects) x loop
    if jsonb_typeof(item)<>'object' or item - array['event_key','subject_ref','key_tag','context_id','evidence_state','evidence_source']::text[] <> '{}'::jsonb
      or not exists(select 1 from jsonb_array_elements(p_events) e where e->>'event_key'=item->>'event_key') then
      raise exception using errcode='23514',message='meta_subject_payload_invalid';
    end if;
    select * into strict m from public.meta_observer_events where waba_id=p_waba_id
      and phone_number_id=p_phone_number_id and event_key=item->>'event_key';
    if exists(select 1 from meta_admin_private.native_subject_evidence e where e.meta_observer_event_id=m.id
      and (e.subject_ref is distinct from item->>'subject_ref' or e.key_tag is distinct from item->>'key_tag'
        or e.context_id is distinct from item->>'context_id' or e.evidence_state is distinct from item->>'evidence_state'
        or e.evidence_source is distinct from item->>'evidence_source')) then
      raise exception using errcode='23514',message='meta_subject_conflict';
    end if;
    -- No backfill, including receipts won by an older receiver. Missing sidecar
    -- remains unknown. A duplicate never hydrates or overwrites an old receipt.
    if m.occurred_at<greatest(epoch,p_not_before) or not exists(select 1 from public.meta_observer_events e
      where e.id=m.id and e.xmin=pg_current_xact_id()::xid) then continue; end if;
    insert into meta_admin_private.native_subject_evidence(meta_observer_event_id,subject_ref,key_tag,context_id,evidence_state,evidence_source)
    values(m.id,item->>'subject_ref',item->>'key_tag',item->>'context_id',item->>'evidence_state',item->>'evidence_source')
    on conflict(meta_observer_event_id) do nothing;
    if found then inserted_subjects:=inserted_subjects+1; end if;
    if not exists(select 1 from meta_admin_private.native_subject_evidence e where e.meta_observer_event_id=m.id
      and e.subject_ref is not distinct from item->>'subject_ref' and e.key_tag=item->>'key_tag'
      and e.context_id is not distinct from item->>'context_id' and e.evidence_state=item->>'evidence_state'
      and e.evidence_source=item->>'evidence_source') then
      raise exception using errcode='23514',message='meta_subject_conflict';
    end if;
  end loop;
  if exists(select 1 from public.meta_observer_events receipt where receipt.waba_id=p_waba_id and receipt.phone_number_id=p_phone_number_id
    and receipt.event_key in(select e->>'event_key' from jsonb_array_elements(p_events) e)
    and receipt.xmin=pg_current_xact_id()::xid and receipt.occurred_at>=greatest(epoch,p_not_before)
    and (receipt.category='app_echo' or exists(select 1 from meta_admin_private.inbound_inputs i where i.meta_observer_event_id=receipt.id))
    and not exists(select 1 from meta_admin_private.native_subject_evidence e where e.meta_observer_event_id=receipt.id)) then
    raise exception using errcode='23514',message='meta_subject_evidence_missing';
  end if;
  return result||jsonb_build_object('subjects_durable',true,'subjects_inserted',inserted_subjects);
end $$;

alter table meta_admin_private.subject_evidence_epoch enable row level security;
alter table meta_admin_private.native_subject_evidence enable row level security;
revoke all on meta_admin_private.subject_evidence_epoch,meta_admin_private.native_subject_evidence from public,anon,authenticated,service_role;
grant select on meta_admin_private.subject_evidence_epoch to service_role;
grant select,insert on meta_admin_private.native_subject_evidence to service_role;
create policy meta_subject_epoch_read on meta_admin_private.subject_evidence_epoch for select to service_role using(true);
create policy meta_subject_read on meta_admin_private.native_subject_evidence for select to service_role using(true);
create policy meta_subject_insert on meta_admin_private.native_subject_evidence for insert to service_role with check(true);
revoke all on function meta_admin_private.guard_subject_evidence_v1(),
  public.capture_meta_admin_shadow_subject_v1(text,text,text,jsonb,timestamptz,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function meta_admin_private.guard_subject_evidence_v1(),
  public.capture_meta_admin_shadow_subject_v1(text,text,text,jsonb,timestamptz,jsonb,jsonb) to service_role;
commit;
