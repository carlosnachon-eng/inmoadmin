-- DEV ONLY: clone sintético para validar la superficie manual P3 sin Anthropic.
begin;
do $$ begin
  if to_regclass('public.shadow_messages') is null or to_regclass('public.shadow_conversations') is null then raise exception 'Shadow DEV requerido'; end if;
  if coalesce(obj_description('public.shadow_messages'::regclass,'pg_class'),'') <> 'dev-bootstrap:202608180005:fase-2a-p0-shadow' then raise exception 'Clone permitido únicamente sobre Shadow DEV'; end if;
end $$;

insert into public.shadow_conversations(id,provider,external_conversation_id,contact_hash,channel,first_message_at,last_message_at,administrative_likelihood,status)
values('f2a30000-0000-4000-8200-000000000001','respond_admin','FASE2A-REAL-MANUAL-DEV-QA','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','544519','2026-08-21T18:00:00Z','2026-08-21T18:00:00Z','high','active')
on conflict (provider,external_conversation_id) do nothing;

insert into public.shadow_messages(id,conversation_id,provider,external_message_id,direction,occurred_at,sanitized_text,content_hash,message_type,attachment_metadata,provider_metadata,processing_state,intent,administrative_likelihood,reason_codes,requires_human)
values('f2a30000-0000-4000-8200-000000000002','f2a30000-0000-4000-8200-000000000001','respond_admin','FASE2A-REAL-MANUAL-DEV-QA','inbound','2026-08-21T18:00:00Z','El mantenimiento sintético sigue pendiente.',encode(extensions.digest('El mantenimiento sintético sigue pendiente.','sha256'),'hex'),'text','[]'::jsonb,'{"realManualDevClone":"FASE2A-REAL-MANUAL-DEV-QA"}'::jsonb,'needs_review','seguimiento_mantenimiento','high',array['dev_real_manual_clone'],true)
on conflict (provider,external_message_id) do nothing;
commit;
