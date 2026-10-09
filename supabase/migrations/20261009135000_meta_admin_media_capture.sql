-- Future-only encrypted media. No backfill, no sender. Apply before receiver code.
begin;
create table meta_admin_private.media_capture_epoch(singleton boolean primary key default true check(singleton), installed_at timestamptz not null default clock_timestamp());
insert into meta_admin_private.media_capture_epoch default values;
alter table meta_admin_private.media_capture_epoch enable row level security;
revoke all on meta_admin_private.media_capture_epoch from public,anon,authenticated,service_role;
grant select on meta_admin_private.media_capture_epoch to service_role;
create policy media_epoch_read on meta_admin_private.media_capture_epoch for select to service_role using(true);
alter table meta_admin_private.inbound_inputs add column media_ciphertext jsonb, add column media_key_tag text;
alter table meta_admin_private.inbound_inputs drop constraint inbound_inputs_capture_reason_check, drop constraint inbound_inputs_check;
alter table meta_admin_private.inbound_inputs add constraint inbound_inputs_capture_reason_check check(capture_reason in ('captured','empty_sanitized_text','unsupported_message_type','media_captured')),
 add constraint inbound_inputs_check check(
 (capture_reason='captured' and message_type='text' and sanitized_text is not null and length(btrim(sanitized_text))>0)
 or (capture_reason='empty_sanitized_text' and message_type='text' and sanitized_text is null)
 or (capture_reason='unsupported_message_type' and message_type<>'text' and sanitized_text is null)
 or (capture_reason='media_captured' and message_type in ('image','document','audio','video') and sanitized_text is null)),
 add constraint media_ciphertext_shape check((
 (capture_reason<>'media_captured' and media_ciphertext is null and media_key_tag is null)
 or (capture_reason='media_captured' and media_key_tag ~ '^[a-f0-9]{64}$' and media_key_tag is not null
 and media_ciphertext is not null and jsonb_typeof(media_ciphertext)='object'
 and media_ciphertext ?& array['v','iv','tag','data']
 and media_ciphertext-array['v','iv','tag','data']='{}'::jsonb
 and media_ciphertext->>'v'='1' and media_ciphertext->>'iv' ~ '^[a-f0-9]{24}$'
 and media_ciphertext->>'tag' ~ '^[a-f0-9]{32}$' and media_ciphertext->>'data' ~ '^([a-f0-9]{2}){1,40}$')) is true);
create or replace function public.capture_meta_admin_shadow_v1(p_waba_id text,p_phone_number_id text,
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
    if item - array['event_key','sender_ciphertext','sender_ref','exact_phone_digest','sender_evidence','sanitized_text','capture_reason','media_key_tag','media_ciphertext']::text[] <> '{}'::jsonb then
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
    if m.occurred_at < (select installed_at from meta_admin_private.media_capture_epoch where singleton) then
      item:=(item-array['media_key_tag','media_ciphertext']) || case when item->>'capture_reason'='media_captured' then '{"capture_reason":"unsupported_message_type"}'::jsonb else '{}'::jsonb end;
    end if;
    insert into meta_admin_private.inbound_inputs(meta_observer_event_id,waba_id,phone_number_id,native_message_id,
      occurred_at,message_type,sender_ref,sender_ciphertext,exact_phone_digest,sender_evidence,sanitized_text,capture_reason,media_key_tag,media_ciphertext)
    values(m.id,m.waba_id,m.phone_number_id,m.native_message_id,m.occurred_at,m.message_type,
      item->>'sender_ref',item->'sender_ciphertext',item->>'exact_phone_digest',item->>'sender_evidence',item->>'sanitized_text',item->>'capture_reason',item->>'media_key_tag',item->'media_ciphertext')
    on conflict(meta_observer_event_id) do nothing;
    if found then captured:=captured+1; end if;
  end loop;
  return observed||jsonb_build_object('captured',captured,'capture_durable',true);
end $$;


create or replace function public.meta_admin_shadow_snapshot_v1(p_input_id uuid)
returns jsonb language sql volatile security definer set search_path='' as $snapshot$
with recursive target as (
 select i.id,i.native_message_id,i.waba_id,i.phone_number_id,i.occurred_at,i.captured_at,
 (i.media_ciphertext is not null and i.media_key_tag=se.key_tag) as media_reference_present,
 i.sanitized_text,i.capture_reason,i.message_type,m.observer_only,m.state observer_state,
 c.enabled and s.enabled as enabled,s.respond_channel_id scope_channel,
 i.sender_ref subject_ref,se.key_tag
 from meta_admin_private.inbound_inputs i
 join public.meta_observer_events m on m.id=i.meta_observer_event_id
 join meta_admin_private.capture_config c on c.waba_id=i.waba_id and c.phone_number_id=i.phone_number_id
 join public.meta_observer_admin_scope s on s.waba_id=i.waba_id and s.phone_number_id=i.phone_number_id
 left join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 where i.id=$1 and i.captured_at>=c.not_before and i.occurred_at>=c.not_before
), echo_roots as (
 select m.id from public.meta_observer_events m join target i using(waba_id,phone_number_id)
 where m.category='app_echo' and (m.occurred_at>=i.occurred_at or m.received_at>=i.captured_at)
), subject_walk(id) as (
 select id from echo_roots
 union
 select parent.id from subject_walk w
 join public.meta_observer_events m on m.id=w.id
 left join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 join public.meta_observer_events parent on parent.waba_id=m.waba_id and parent.phone_number_id=m.phone_number_id
   and parent.category in ('inbound','app_echo')
   and parent.native_message_id in (se.context_id,m.original_message_id)
), subject_nodes as (
 select m.id event_id,m.native_message_id,m.waba_id,m.phone_number_id,m.original_message_id,
 se.subject_ref,se.key_tag,se.context_id,se.evidence_state
 from subject_walk w join public.meta_observer_events m on m.id=w.id
 left join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 where m.observer_only and m.state='observed' limit 1001
)
select jsonb_build_object('input',to_jsonb(i)-array['enabled','scope_channel'],
 'enabled',i.enabled,'scope_channel',i.scope_channel,'checked_at',statement_timestamp(),
 'identity',public.resolve_meta_admin_identity_v1(i.id),
 'latest_received_at',(select max(m.received_at) from public.meta_observer_events m
   where m.waba_id=i.waba_id and m.phone_number_id=i.phone_number_id),
 'mutated',exists(select 1 from public.meta_observer_events m where m.waba_id=i.waba_id
   and m.phone_number_id=i.phone_number_id and m.original_message_id=i.native_message_id),
 'later_scope_echoes',(select count(*) from echo_roots),
 'echo_roots',coalesce((select jsonb_agg(id) from echo_roots),'[]'::jsonb),
 'subject_nodes',coalesce((select jsonb_agg(to_jsonb(n)) from subject_nodes n),'[]'::jsonb),
 'later_scope_uncertain',(select count(*) from public.meta_observer_events m
   where m.waba_id=i.waba_id and m.phone_number_id=i.phone_number_id
   and (m.occurred_at>=i.occurred_at or m.received_at>=i.captured_at)
   and (m.state<>'observed' or not m.observer_only or cardinality(m.error_codes)>0))
) snapshot from target i
$snapshot$;

create or replace function public.meta_admin_memory_evidence_v1(p_input_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
with target as (
 select i.*,se.subject_ref,se.key_tag,
  coalesce(se.evidence_state='exact' and se.evidence_source='signed_from'
    and se.subject_ref=i.sender_ref and se.key_tag ~ '^[a-f0-9]{64}$' and se.subject_ref ~ '^[a-f0-9]{64}$'
    and i.sender_evidence in ('signed_from','signed_from_and_wa_id') and m.category='inbound'
    and m.source_field='messages' and m.event_type='message.received'
    and m.state='observed' and m.observer_only and cardinality(m.error_codes)=0
    and m.native_message_id=i.native_message_id and m.waba_id=i.waba_id and m.phone_number_id=i.phone_number_id
    and (i.capture_reason='captured' or (i.capture_reason='media_captured' and i.media_ciphertext is not null and i.media_key_tag=se.key_tag)),false) as native_verified,
  coalesce(s.respond_channel_id='544519' and s.enabled,false) as scope_verified
 from meta_admin_private.inbound_inputs i
 join public.meta_observer_events m on m.id=i.meta_observer_event_id
 left join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 left join public.meta_observer_admin_scope s on s.waba_id=i.waba_id and s.phone_number_id=i.phone_number_id
 where i.id=p_input_id and i.waba_id='1297760461811288' and i.phone_number_id='1198305790026665'
), evidence as (
 select t.*,public.resolve_meta_admin_identity_v1(t.id) as identity,
  exists(select 1 from public.profiles p where p.role in ('admin','staff') and (
   public.identity_phone_digest(p.telefono)=t.exact_phone_digest
   or exists(select 1 from public.client_identities c where c.phone_digest=t.exact_phone_digest and c.auth_user_id=p.id))) as staff
 from target t
), audience as (
 select e.*,case when staff then 'internal'
 when identity->>'state'='matched'
  and exists(select 1 from public.client_identity_roles r where r.client_identity_id=(identity->>'client_identity_id')::uuid
   and r.role_kind in ('owner','tenant') and r.status='active' and r.revoked_at is null)
  and not exists(select 1 from public.client_identity_roles r where r.client_identity_id=(identity->>'client_identity_id')::uuid
   and (r.status<>'active' or r.revoked_at is not null))
  and exists(select 1 from public.client_source_links l join public.client_identity_roles r
   on r.client_identity_id=l.client_identity_id and r.role_kind=l.role_kind
   where l.client_identity_id=(identity->>'client_identity_id')::uuid and l.link_status='confirmed'
   and l.revoked_at is null and l.confirmed_by is not null and l.confirmed_at is not null
   and r.status='active' and r.revoked_at is null)
 then 'external_verified' else 'unknown' end as audience_state
 from evidence e
)
select jsonb_build_object('input_id',id,'checked_at',statement_timestamp(),'subject_ref',subject_ref,'key_tag',key_tag,
 'native_verified',native_verified,'scope_verified',scope_verified,'audience',audience_state,
 'audience_reason',case audience_state when 'internal' then 'exact_staff_identity' when 'external_verified'
  then 'confirmed_external_canonical_role' else 'external_identity_not_accredited' end,
 'human_authorized',false,'authorizes_private_data',false)
from audience
$$;

create or replace function public.meta_admin_memory_history_v1(p_input_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare proof jsonb; result jsonb;
begin
 proof:=public.meta_admin_memory_evidence_v1(p_input_id);
 if proof is null or (proof->>'native_verified')::boolean is distinct from true
  or (proof->>'scope_verified')::boolean is distinct from true then raise exception 'memory_native_scope_unverified'; end if;
 -- Unknown can clarify, but cannot retrieve private historic text. Staff never enters customer context.
 if proof->>'audience'<>'external_verified' then return '[]'::jsonb; end if;
 with target as (
  select i.*,se.key_tag from meta_admin_private.inbound_inputs i
  join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=i.meta_observer_event_id
  where i.id=p_input_id
 ), history as (
  select coalesce(i.id,m.id) as id,
   case when m.category='inbound' and m.source_field='messages' and m.event_type='message.received'
     and se.evidence_source='signed_from' and i.id is not null and i.sender_ref=se.subject_ref
     and i.sender_evidence in ('signed_from','signed_from_and_wa_id') then 'customer_inbound'
    when m.category='app_echo' and m.source_field='smb_message_echoes' and m.event_type='message.sent'
     and se.evidence_source='signed_to' then 'business_outbound_unattributed' else 'unknown' end as provenance,
   coalesce(i.sanitized_text,case when m.category='inbound' then case when m.message_type='image' then '[IMAGEN]' else '[DOCUMENTO]' end else '[BUSINESS_OUTBOUND_CONTENT_UNAVAILABLE]' end) as sanitized_text,
   m.message_type,m.occurred_at,m.received_at as captured_at,
   i.sanitized_text is null as content_missing,
   exists(select 1 from public.meta_observer_events x where x.waba_id=m.waba_id and x.phone_number_id=m.phone_number_id
    and x.original_message_id=m.native_message_id) as mutated
  from target t join public.meta_observer_events m on m.waba_id=t.waba_id and m.phone_number_id=t.phone_number_id
  join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
   and se.subject_ref=t.sender_ref and se.key_tag=t.key_tag and se.evidence_state='exact'
  left join meta_admin_private.inbound_inputs i on i.meta_observer_event_id=m.id
   and i.waba_id=m.waba_id and i.phone_number_id=m.phone_number_id and i.native_message_id=m.native_message_id
  where m.observer_only and m.state='observed' and cardinality(m.error_codes)=0
   and m.category in ('inbound','app_echo')
   and (m.occurred_at,m.received_at)<=(t.occurred_at,t.captured_at)
  order by m.occurred_at,m.received_at,m.id limit 501
 ) select coalesce(jsonb_agg(to_jsonb(h) order by occurred_at,captured_at,id),'[]'::jsonb) into result from history h;
 if jsonb_array_length(result)>500 then raise exception 'history_limit'; end if;
 if exists(select 1 from jsonb_array_elements(result) r where r->>'provenance'='unknown') then raise exception 'history_provenance_unknown'; end if;
 return result;
end $$;

create table meta_admin_private.media_shadow_attempts(
 input_id uuid primary key references meta_admin_private.inbound_inputs(id),
 reserved_at timestamptz not null default clock_timestamp(),
 attempt integer not null default 1 check(attempt=1));
alter table meta_admin_private.media_shadow_attempts enable row level security;
revoke all on meta_admin_private.media_shadow_attempts from public,anon,authenticated,service_role;
create trigger immutable_media_attempt before update or delete on meta_admin_private.media_shadow_attempts
 for each row execute function meta_admin_memory_private.immutable_memory();
create function public.meta_admin_shadow_media_claim_v1(p_input_id uuid,p_token uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from meta_admin_private.shadow_once_runs r where r.input_id=p_input_id
 and r.claim_token=p_token and r.status='model_started') then raise exception 'media_claim_denied'; end if;
 select jsonb_build_object('input_id',i.id,'waba_id',i.waba_id,'phone_number_id',i.phone_number_id,
 'event_key',m.event_key,'native_message_id',i.native_message_id,'subject_ref',i.sender_ref,
 'key_tag',i.media_key_tag,'media_ciphertext',i.media_ciphertext) into result
 from meta_admin_private.inbound_inputs i join public.meta_observer_events m on m.id=i.meta_observer_event_id
 join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 where i.id=p_input_id and i.capture_reason='media_captured' and i.media_ciphertext is not null
 and i.waba_id='1297760461811288' and i.phone_number_id='1198305790026665'
 and i.sender_ref=se.subject_ref and i.media_key_tag=se.key_tag and se.evidence_state='exact'
 and se.evidence_source='signed_from' and i.message_type in ('image','document');
 if result is null then raise exception 'media_reference_unavailable'; end if;
 insert into meta_admin_private.media_shadow_attempts(input_id) values(p_input_id) on conflict do nothing;
 if not found then raise exception 'media_attempt_consumed'; end if;
 return result;
end $$;
revoke all on function public.meta_admin_shadow_media_claim_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_shadow_media_claim_v1(uuid,uuid) to service_role;
commit;
