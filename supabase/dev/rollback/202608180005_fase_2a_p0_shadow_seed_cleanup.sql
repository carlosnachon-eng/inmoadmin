-- DEV ONLY. Limpia exclusivamente telemetría y fixtures namespaced FASE2A-QA/P0.
begin;
delete from public.shadow_conversations where provider='synthetic' and external_conversation_id like 'FASE2A-P0-%';
delete from public.shadow_ingestion_events where provider='synthetic' and external_event_id like 'FASE2A-P0-%';
delete from public.administrative_case_controls where context_key='fase2a-qa:legal-review:house-101';
delete from public.llaves where id='f2aa0000-0000-4000-8200-000000000001';
delete from public.owner_payments where id='f2a80000-0000-4000-8200-000000000001';
delete from public.pagos_servicios where id in ('f2a60000-0000-4000-8200-000000000001','f2a60000-0000-4000-8200-000000000002');
delete from public.servicios_inmueble where id in ('f2a50000-0000-4000-8200-000000000001','f2a50000-0000-4000-8200-000000000002');
delete from public.maintenance_tickets where id in ('f2a30000-0000-4000-8200-000000000001','f2a30000-0000-4000-8200-000000000002');
delete from public.payments where id='f2a20000-0000-4000-8200-000000000001';
delete from public.contracts where id in ('f2a10000-0000-4000-8200-000000000001','f2a10000-0000-4000-8200-000000000002');
delete from public.properties where id in ('f2a00000-0000-4000-8200-000000000001','f2a00000-0000-4000-8200-000000000002');
commit;
