-- DEV ONLY. Limpia exclusivamente datos namespaced FASE2A-P0.
begin;
delete from public.shadow_conversations where provider='synthetic' and external_conversation_id like 'FASE2A-P0-%';
delete from public.shadow_ingestion_events where provider='synthetic' and external_event_id like 'FASE2A-P0-%';
commit;
