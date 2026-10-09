-- History is evidence, never a private-data grant. No table/history mutation.
begin;
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
    and i.capture_reason='captured',false) as native_verified,
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

create function public.meta_admin_memory_history_v1(p_input_id uuid)
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
   coalesce(i.sanitized_text,'[BUSINESS_OUTBOUND_CONTENT_UNAVAILABLE]') as sanitized_text,
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
revoke all on function public.meta_admin_memory_evidence_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.meta_admin_memory_history_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_memory_evidence_v1(uuid) to service_role;
grant execute on function public.meta_admin_memory_history_v1(uuid) to service_role;
commit;
