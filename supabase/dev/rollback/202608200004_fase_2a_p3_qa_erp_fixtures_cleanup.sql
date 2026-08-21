-- DEV ONLY. Elimina exclusivamente fixtures namespaced FASE2A-P3-QA.
begin;
delete from public.administrative_case_controls where context_key='maintenance_ticket:f2a30000-0000-4000-8400-000000000001';
delete from public.llaves where id='f2a30000-0000-4000-8800-000000000001' and notas='FASE2A-P3-QA llave resoluble';
delete from public.owner_payments where id='f2a30000-0000-4000-8700-000000000001' and notes='FASE2A-P3-QA liquidación resoluble';
delete from public.pagos_servicios where id in ('f2a30000-0000-4000-8600-000000000001','f2a30000-0000-4000-8600-000000000002') and subido_por='FASE2A-P3-QA';
delete from public.servicios_inmueble where id in ('f2a30000-0000-4000-8500-000000000001','f2a30000-0000-4000-8500-000000000002') and notas like 'FASE2A-P3-QA servicio % resoluble';
delete from public.maintenance_tickets where id='f2a30000-0000-4000-8400-000000000001' and title='FASE2A-P3-QA Fuga Montpellier';
delete from public.payments where id='f2a30000-0000-4000-8300-000000000001' and property_name='FASE2A-P3-QA Montpellier 101';
delete from public.contracts where id='f2a30000-0000-4000-8200-000000000001' and property_name='FASE2A-P3-QA Montpellier 101';
delete from public.properties where id in ('f2a30000-0000-4000-8100-000000000001','f2a30000-0000-4000-8100-000000000002') and name ilike 'FASE2A-P3-QA Montpellier%';
commit;
