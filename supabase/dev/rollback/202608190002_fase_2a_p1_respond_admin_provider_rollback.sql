-- DEV ONLY: rollback del provider Respond/Admin. No elimina mensajes.
begin;

do $$
begin
  if coalesce(obj_description('public.shadow_conversations'::regclass,'pg_class'),'')
       <> 'dev-bootstrap:202608180005:fase-2a-p0-shadow'
     or coalesce(obj_description('public.shadow_messages'::regclass,'pg_class'),'')
       <> 'dev-bootstrap:202608180005:fase-2a-p0-shadow'
     or coalesce(obj_description('public.ingest_shadow_message(jsonb,jsonb)'::regprocedure,'pg_proc'),'')
       <> 'dev-bootstrap:202608190002:fase-2a-p1-respond-admin' then
    raise exception 'Rollback P1 rechazado: ownership DEV no comprobado';
  end if;
  if exists(select 1 from public.shadow_conversations where provider='respond_admin')
     or exists(select 1 from public.shadow_messages where provider='respond_admin') then
    raise exception 'Rollback P1 rechazado: existen datos respond_admin; no se borrarán automáticamente';
  end if;
end $$;

alter table public.shadow_conversations drop constraint shadow_conversations_provider_check;
alter table public.shadow_conversations add constraint shadow_conversations_provider_check
  check (provider in ('synthetic','respond','meta','bsp'));
alter table public.shadow_messages drop constraint shadow_messages_direction_check;
alter table public.shadow_messages add constraint shadow_messages_direction_check
  check (direction in ('inbound','outbound'));

create or replace function public.ingest_shadow_message(p_envelope jsonb, p_classification jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_event uuid; v_conversation uuid; v_message uuid; v_existing uuid;
begin
  if coalesce(p_envelope->>'provider','') not in ('synthetic','respond') then raise exception 'Provider P0 no permitido'; end if;
  select id into v_existing from public.shadow_messages where provider=p_envelope->>'provider' and external_message_id=p_envelope->>'externalMessageId';
  if v_existing is not null then
    update public.shadow_ingestion_events set duplicate_count=duplicate_count+1 where provider=p_envelope->>'provider' and (external_message_id=p_envelope->>'externalMessageId' or payload_fingerprint=p_envelope->>'payloadFingerprint');
    return jsonb_build_object('status','duplicate','messageId',v_existing);
  end if;
  insert into public.shadow_ingestion_events(provider,external_event_id,external_message_id,payload_fingerprint,status,sanitization_changed,processed_at)
  values(p_envelope->>'provider',p_envelope->>'externalEventId',p_envelope->>'externalMessageId',p_envelope->>'payloadFingerprint',case when (p_envelope->>'sanitizationRejected')::boolean then 'rejected' else 'accepted' end,coalesce((p_envelope->>'sanitizationChanged')::boolean,false),now())
  on conflict(provider,payload_fingerprint) do update set duplicate_count=shadow_ingestion_events.duplicate_count+1 returning id into v_event;
  if (p_envelope->>'sanitizationRejected')::boolean then return jsonb_build_object('status','rejected','eventId',v_event); end if;
  insert into public.shadow_conversations(provider,external_conversation_id,contact_hash,channel,first_message_at,last_message_at,administrative_likelihood)
  values(p_envelope->>'provider',p_envelope->>'externalConversationId',p_envelope->>'externalContactHash',p_envelope->>'channel',(p_envelope->>'occurredAt')::timestamptz,(p_envelope->>'occurredAt')::timestamptz,p_classification->>'administrativeLikelihood')
  on conflict(provider,external_conversation_id) do update set first_message_at=least(shadow_conversations.first_message_at,excluded.first_message_at),last_message_at=greatest(shadow_conversations.last_message_at,excluded.last_message_at),administrative_likelihood=excluded.administrative_likelihood,updated_at=now() returning id into v_conversation;
  insert into public.shadow_messages(conversation_id,ingestion_event_id,provider,external_message_id,direction,occurred_at,sanitized_text,content_hash,message_type,attachment_metadata,provider_metadata,processing_state,intent,administrative_likelihood,reason_codes,requires_human)
  values(v_conversation,v_event,p_envelope->>'provider',p_envelope->>'externalMessageId',p_envelope->>'direction',(p_envelope->>'occurredAt')::timestamptz,p_envelope->>'sanitizedText',encode(extensions.digest(p_envelope->>'sanitizedText','sha256'),'hex'),case when jsonb_array_length(p_envelope->'attachmentMetadata')>0 and coalesce(p_envelope->>'sanitizedText','')<>'' then 'mixed' when jsonb_array_length(p_envelope->'attachmentMetadata')>0 then 'attachment' else 'text' end,p_envelope->'attachmentMetadata',p_envelope->'providerMetadata',case when (p_classification->>'requiresHuman')::boolean then 'needs_review' else 'classified' end,p_classification->>'intent',p_classification->>'administrativeLikelihood',array(select jsonb_array_elements_text(p_classification->'reasonCodes')),(p_classification->>'requiresHuman')::boolean) returning id into v_message;
  return jsonb_build_object('status','accepted','messageId',v_message,'conversationId',v_conversation);
end $$;
revoke all on function public.ingest_shadow_message(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_shadow_message(jsonb,jsonb) to service_role;
comment on function public.ingest_shadow_message(jsonb,jsonb) is null;

commit;
