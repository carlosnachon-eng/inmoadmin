begin;

-- Not an exposed Data API schema. Trusted Admin backend only; no new login,
-- credentials, default privileges, business tables, source triggers or consumers.
create schema meta_admin_private;
revoke all on schema meta_admin_private from public,anon,authenticated,service_role;
grant usage on schema meta_admin_private to service_role;

-- EMPTY: rollout/activation is separately authorized. Both DB + environment
-- must agree on the exact cutover. No ability for service_role to activate it.
create table meta_admin_private.capture_config (
  singleton boolean primary key default true check(singleton),
  waba_id text not null,
  phone_number_id text not null,
  enabled boolean not null default false,
  installed_at timestamptz not null default clock_timestamp(),
  not_before timestamptz not null,
  check(not_before >= installed_at),
  foreign key(waba_id,phone_number_id) references public.meta_observer_admin_scope(waba_id,phone_number_id)
);

create table meta_admin_private.inbound_inputs (
  id uuid primary key default gen_random_uuid(),
  meta_observer_event_id uuid not null unique references public.meta_observer_events(id),
  waba_id text not null,
  phone_number_id text not null,
  native_message_id text not null,
  occurred_at timestamptz not null,
  message_type text not null,
  captured_at timestamptz not null default clock_timestamp(),
  sender_ref text not null check(sender_ref ~ '^[a-f0-9]{64}$'),
  sender_ciphertext jsonb not null check(jsonb_typeof(sender_ciphertext)='object'
    and sender_ciphertext ?& array['v','iv','tag','data']::text[]
    and sender_ciphertext->>'v'='1'
    and sender_ciphertext->>'iv' ~ '^[a-f0-9]{24}$'
    and sender_ciphertext->>'tag' ~ '^[a-f0-9]{32}$'
    and sender_ciphertext->>'data' ~ '^[a-f0-9]{16,30}$'
    and sender_ciphertext - array['v','iv','tag','data']::text[] = '{}'::jsonb),
  exact_phone_digest text not null check(exact_phone_digest ~ '^[a-f0-9]{64}$'),
  sender_evidence text not null check(sender_evidence in ('signed_from','signed_from_and_wa_id')),
  sanitized_text text check(length(sanitized_text) between 1 and 2000),
  capture_reason text not null check(capture_reason in ('captured','empty_sanitized_text','unsupported_message_type')),
  check((capture_reason='captured' and message_type='text' and sanitized_text is not null and length(btrim(sanitized_text))>0)
    or (capture_reason='empty_sanitized_text' and message_type='text' and sanitized_text is null)
    or (capture_reason='unsupported_message_type' and message_type<>'text' and sanitized_text is null)),
  unique(waba_id,phone_number_id,native_message_id)
);
create index meta_admin_input_subject_idx on meta_admin_private.inbound_inputs(waba_id,phone_number_id,sender_ref,occurred_at);

-- This is a PRE-MODEL audit, not a fabricated agent run. No positive grant,
-- override, resume, sender or model path is introduced by this migration.
create table meta_admin_private.shadow_preflights (
  id uuid primary key default gen_random_uuid(),
  input_id uuid not null unique references meta_admin_private.inbound_inputs(id),
  created_at timestamptz not null default clock_timestamp(),
  identity_state text not null check(identity_state in ('matched','ambiguous','unmatched')),
  status text not null default 'blocked' check(status='blocked'),
  reason text not null check(reason in ('capture_not_eligible','event_mutated','identity_unmatched','identity_ambiguous','meta_human_attention_unverified')),
  run_id text check(run_id is null),
  proposed_response text check(proposed_response is null),
  model_calls integer not null default 0 check(model_calls=0),
  send_calls integer not null default 0 check(send_calls=0)
);

create function meta_admin_private.guard_input_v1() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.meta_observer_events m
    join public.meta_observer_admin_scope s using(waba_id,phone_number_id)
    join meta_admin_private.capture_config c using(waba_id,phone_number_id)
    where m.id=new.meta_observer_event_id and s.enabled and c.enabled and s.respond_channel_id='544519'
      and m.event_type='message.received' and m.category='inbound' and m.source_field='messages'
      and m.native_message_id=new.native_message_id and m.message_type=new.message_type
      and m.waba_id=new.waba_id and m.phone_number_id=new.phone_number_id and m.occurred_at=new.occurred_at
      and m.observer_only and m.state='observed'
      and m.xmin=pg_current_xact_id()::xid -- this transaction created the receipt
      and m.received_at>=statement_timestamp() -- cannot hydrate an older observation
      and m.occurred_at>=c.not_before and m.received_at>=c.not_before
      and m.occurred_at<=clock_timestamp()+interval '5 minutes') then
    raise exception using errcode='23514',message='meta_admin_capture_not_eligible';
  end if;
  return new;
end $$;
create trigger meta_admin_input_guard before insert on meta_admin_private.inbound_inputs
  for each row execute function meta_admin_private.guard_input_v1();

-- Atomically commit existing observer receipt + the restricted future input.
-- Existing observations are NEVER hydrated. Retries keep their original data.
create function public.capture_meta_admin_shadow_v1(p_waba_id text,p_phone_number_id text,
  p_body_sha256 text,p_events jsonb,p_not_before timestamptz,p_inputs jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cfg meta_admin_private.capture_config%rowtype; old_keys text[]; observed jsonb;
  item jsonb; m public.meta_observer_events%rowtype; captured integer:=0;
begin
  select * into cfg from meta_admin_private.capture_config where singleton;
  if cfg.enabled is distinct from true or cfg.waba_id is distinct from p_waba_id
    or cfg.phone_number_id is distinct from p_phone_number_id or cfg.not_before is distinct from p_not_before
    or cfg.not_before>clock_timestamp() then
    raise exception using errcode='23514',message='meta_admin_capture_disabled';
  end if;
  if p_inputs is null or jsonb_typeof(p_inputs)<>'array' or jsonb_array_length(p_inputs)>100 then
    raise exception using errcode='23514',message='meta_admin_capture_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('meta_admin_capture:'||p_waba_id||':'||p_phone_number_id,0));
  select coalesce(array_agg(event_key),'{}'::text[]) into old_keys from public.meta_observer_events
    where waba_id=p_waba_id and phone_number_id=p_phone_number_id
      and event_key in (select x->>'event_key' from jsonb_array_elements(p_events) x);
  observed:=public.observe_meta_admin_events_v1(p_waba_id,p_phone_number_id,p_body_sha256,p_events);
  for item in select x from jsonb_array_elements(p_inputs) x loop
    if item - array['event_key','sender_ciphertext','sender_ref','exact_phone_digest','sender_evidence','sanitized_text','capture_reason']::text[] <> '{}'::jsonb then
      raise exception using errcode='23514',message='meta_admin_capture_invalid';
    end if;
    if item->>'event_key'=any(old_keys) then continue; end if;
    if not exists(select 1 from jsonb_array_elements(p_events) e where e->>'event_key'=item->>'event_key') then
      raise exception using errcode='23514',message='meta_admin_capture_invalid';
    end if;
    select * into strict m from public.meta_observer_events where waba_id=p_waba_id
      and phone_number_id=p_phone_number_id and event_key=item->>'event_key';
    -- An OFF/older receiver can win concurrently after old_keys was read.
    -- Never attach content to the receipt committed by that other transaction.
    if not exists(select 1 from public.meta_observer_events e where e.id=m.id
      and e.xmin=pg_current_xact_id()::xid) then continue; end if;
    -- Old provider retries can still be observed, but never enter the input store.
    if m.occurred_at<cfg.not_before then continue; end if;
    insert into meta_admin_private.inbound_inputs(meta_observer_event_id,waba_id,phone_number_id,native_message_id,
      occurred_at,message_type,sender_ref,sender_ciphertext,exact_phone_digest,sender_evidence,sanitized_text,capture_reason)
    values(m.id,m.waba_id,m.phone_number_id,m.native_message_id,m.occurred_at,m.message_type,
      item->>'sender_ref',item->'sender_ciphertext',item->>'exact_phone_digest',item->>'sender_evidence',item->>'sanitized_text',item->>'capture_reason')
    on conflict(meta_observer_event_id) do nothing;
    if found then captured:=captured+1; end if;
  end loop;
  return observed||jsonb_build_object('captured',captured,'capture_durable',true);
end $$;

-- Read-only exact digest equality to already-established canonical identities.
-- No names, suffixes, phone repair, Respond, temporal correlation or link writes.
create function public.resolve_meta_admin_identity_v1(p_input_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare i meta_admin_private.inbound_inputs%rowtype; ids uuid[]; identity_id uuid; reason text;
begin
  select * into strict i from meta_admin_private.inbound_inputs where id=p_input_id;
  select array_agg(id order by id) into ids from public.client_identities where phone_digest=i.exact_phone_digest;
  if coalesce(cardinality(ids),0)=0 then
    return jsonb_build_object('state','unmatched','reason','no_exact_identity','candidate_count',0,'authorizes_business',false);
  elsif cardinality(ids)>1 then
    return jsonb_build_object('state','ambiguous','reason','multiple_exact_identities','candidate_count',cardinality(ids),'authorizes_business',false);
  end if;
  identity_id:=ids[1];
  if not exists(select 1 from public.client_identities c where c.id=identity_id and c.status='active' and c.revoked_at is null)
    or not exists(select 1 from public.client_source_links l where l.client_identity_id=identity_id
      and l.link_status='confirmed' and l.confirmed_by is not null and l.confirmed_at is not null and l.revoked_at is null) then
    return jsonb_build_object('state','unmatched','reason','identity_not_confirmed_active','candidate_count',1,'authorizes_business',false);
  end if;
  return jsonb_build_object('state','matched','reason','exact_existing_canonical_phone','candidate_count',1,
    'client_identity_id',identity_id,'authorizes_business',false);
end $$;

create function public.prepare_meta_admin_shadow_v1(p_input_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare i meta_admin_private.inbound_inputs%rowtype; assessment jsonb;
  attempt meta_admin_private.shadow_preflights%rowtype; why text;
begin
  perform pg_advisory_xact_lock(hashtextextended('meta_admin_preflight:'||p_input_id::text,0));
  select * into attempt from meta_admin_private.shadow_preflights where input_id=p_input_id;
  if found then return to_jsonb(attempt)||jsonb_build_object('reused',true); end if;
  select * into strict i from meta_admin_private.inbound_inputs where id=p_input_id;
  assessment:=public.resolve_meta_admin_identity_v1(p_input_id);
  if i.capture_reason<>'captured' then why:='capture_not_eligible';
  elsif exists(select 1 from public.meta_observer_events m where m.waba_id=i.waba_id and m.phone_number_id=i.phone_number_id
    and m.original_message_id=i.native_message_id and m.event_type in ('message.edit','message.revoke')) then why:='event_mutated';
  elsif assessment->>'state'='unmatched' then why:='identity_unmatched';
  elsif assessment->>'state'='ambiguous' then why:='identity_ambiguous';
  else why:='meta_human_attention_unverified'; end if;
  insert into meta_admin_private.shadow_preflights(input_id,identity_state,reason)
    values(p_input_id,assessment->>'state',why) returning * into attempt;
  return to_jsonb(attempt)||jsonb_build_object('reused',false);
end $$;

alter table meta_admin_private.capture_config enable row level security;
alter table meta_admin_private.inbound_inputs enable row level security;
alter table meta_admin_private.shadow_preflights enable row level security;
revoke all on meta_admin_private.capture_config,meta_admin_private.inbound_inputs,meta_admin_private.shadow_preflights
  from public,anon,authenticated,service_role;
grant select on meta_admin_private.capture_config to service_role;
grant select,insert on meta_admin_private.inbound_inputs,meta_admin_private.shadow_preflights to service_role;
create policy meta_capture_config_read on meta_admin_private.capture_config for select to service_role using(true);
create policy meta_capture_input_read on meta_admin_private.inbound_inputs for select to service_role using(true);
create policy meta_capture_input_insert on meta_admin_private.inbound_inputs for insert to service_role with check(true);
create policy meta_capture_preflight_read on meta_admin_private.shadow_preflights for select to service_role using(true);
create policy meta_capture_preflight_insert on meta_admin_private.shadow_preflights for insert to service_role with check(true);
revoke all on function meta_admin_private.guard_input_v1(),
  public.capture_meta_admin_shadow_v1(text,text,text,jsonb,timestamptz,jsonb),
  public.resolve_meta_admin_identity_v1(uuid),public.prepare_meta_admin_shadow_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function meta_admin_private.guard_input_v1(),
  public.capture_meta_admin_shadow_v1(text,text,text,jsonb,timestamptz,jsonb),
  public.resolve_meta_admin_identity_v1(uuid),public.prepare_meta_admin_shadow_v1(uuid) to service_role;

commit;
