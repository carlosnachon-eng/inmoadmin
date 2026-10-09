-- LOCAL REVIEW DRAFT. No remote application. Requires #185.
begin;
create function public.meta_admin_inbox_list_v1(p_before timestamptz default null, p_limit integer default 30)
returns jsonb language sql stable security definer set search_path='' as $$
with latest as (
 select distinct on(i.waba_id,i.phone_number_id,i.sender_ref,se.key_tag)
 i.id,i.waba_id,i.phone_number_id,i.sender_ref,se.key_tag,i.captured_at
 from meta_admin_private.inbound_inputs i
 join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=i.meta_observer_event_id
  and se.subject_ref=i.sender_ref and se.evidence_state='exact' and se.evidence_source='signed_from'
 join public.meta_observer_events m on m.id=i.meta_observer_event_id and m.native_message_id=i.native_message_id
  and m.waba_id=i.waba_id and m.phone_number_id=i.phone_number_id
 where i.waba_id='1297760461811288' and i.phone_number_id='1198305790026665'
  and m.category='inbound' and m.source_field='messages' and m.event_type='message.received'
  and m.observer_only and m.state='observed' and cardinality(m.error_codes)=0
 order by i.waba_id,i.phone_number_id,i.sender_ref,se.key_tag,i.captured_at desc,i.id desc
), activity as (
 select l.id,greatest(l.captured_at,coalesce((select max(m.received_at)
 from public.meta_observer_events m join meta_admin_private.native_subject_evidence s on s.meta_observer_event_id=m.id
 where m.waba_id=l.waba_id and m.phone_number_id=l.phone_number_id and s.subject_ref=l.sender_ref
 and s.key_tag=l.key_tag and s.evidence_state='exact' and m.observer_only and m.state='observed'),l.captured_at)) last_activity
 from latest l
), page as (
 select a.*,public.resolve_meta_admin_identity_v1(a.id)->>'state' identity_state,
 public.meta_admin_memory_evidence_v1(a.id)->>'audience' audience
 from activity a where p_before is null or a.last_activity<p_before
 order by a.last_activity desc,a.id limit least(greatest(coalesce(p_limit,30),1),100)
)
select coalesce(jsonb_agg(jsonb_build_object('input_id',id,'last_activity',last_activity,
 'identity_state',identity_state,'audience',audience) order by last_activity desc,id),'[]'::jsonb)
from page where audience is distinct from 'internal'
$$;

create function public.meta_admin_inbox_history_v1(p_input_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
with target as (
 select i.*,se.key_tag from meta_admin_private.inbound_inputs i
 join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=i.meta_observer_event_id
 and se.subject_ref=i.sender_ref and se.evidence_state='exact' and se.evidence_source='signed_from'
 where i.id=p_input_id and i.waba_id='1297760461811288' and i.phone_number_id='1198305790026665'
 and public.meta_admin_memory_evidence_v1(i.id)->>'audience' is distinct from 'internal'
), rows as (
 select m.id,m.occurred_at,m.received_at,m.message_type,
 case when m.category='inbound' then 'customer_inbound' else 'business_outbound_unattributed' end provenance,
 i.sanitized_text,i.media_ciphertext is not null media_reference_present,
 exists(select 1 from public.meta_observer_events x where x.waba_id=m.waba_id
 and x.phone_number_id=m.phone_number_id and x.original_message_id=m.native_message_id
 and x.event_type in ('message.edit','message.revoke')) mutated
 from target t join public.meta_observer_events m on m.waba_id=t.waba_id and m.phone_number_id=t.phone_number_id
 join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 and se.subject_ref=t.sender_ref and se.key_tag=t.key_tag and se.evidence_state='exact'
 left join meta_admin_private.inbound_inputs i on i.meta_observer_event_id=m.id and i.sender_ref=t.sender_ref
 where m.observer_only and m.state='observed' and cardinality(m.error_codes)=0
 and ((m.category='inbound' and m.source_field='messages' and m.event_type='message.received' and se.evidence_source='signed_from')
 or (m.category='app_echo' and m.source_field='smb_message_echoes' and se.evidence_source='signed_to'))
 order by m.occurred_at desc,m.received_at desc,m.id desc limit 101
)
select coalesce(jsonb_agg(jsonb_build_object('message_ref',id,'occurred_at',occurred_at,
 'provenance',provenance,'message_type',message_type,'text',case when mutated then null else sanitized_text end,
 'mutated',mutated,'media_reference_present',media_reference_present)
 order by occurred_at,received_at,id),'[]'::jsonb) from rows
$$;
revoke all on function public.meta_admin_inbox_list_v1(timestamptz,integer) from public,anon,authenticated,service_role;
revoke all on function public.meta_admin_inbox_history_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_inbox_list_v1(timestamptz,integer) to service_role;
grant execute on function public.meta_admin_inbox_history_v1(uuid) to service_role;
commit;
