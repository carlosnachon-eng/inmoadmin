-- DEV-only synthetic fixtures: exactly four operational events.
begin;
do $$ begin
  if to_regclass('public.inmoadmin_operational_events') is null
     or coalesce(obj_description('public.inmoadmin_operational_events'::regclass,'pg_class'),'') <> 'dev-bootstrap:202608210001:fase-2a-shadow-operational-outbox' then raise exception 'Bootstrap Operational Events no aplicado'; end if;
  if to_regclass('public.properties') is null or not exists(select 1 from public.properties where id='f2a30000-0000-4000-8100-000000000001') then raise exception 'Fixture property P3 requerido'; end if;
end $$;

insert into public.maintenance_tickets(id,property_id,maintenance_scope,external_job_reference,property_name,title,description,category,priority,status,payer,provider_cost,charged_amount,created_at,updated_at)
values
('f2a40000-0000-4000-8100-000000000001','f2a30000-0000-4000-8100-000000000001','managed_property',null,'FASE2A-OP-EVENT-QA Managed','FASE2A-OP-EVENT-QA Ticket managed','Fixture sintético','otro','media','aprobado','propietario',1000,1300,'2026-08-21T16:00:00Z','2026-08-21T16:05:00Z'),
('f2a40000-0000-4000-8100-000000000002',null,'external_job','FASE2A-OP-EVENT-QA-EXT-01','FASE2A-OP-EVENT-QA External','FASE2A-OP-EVENT-QA Ticket external','Fixture sintético','otro','media','aprobado','propietario',2000,2600,'2026-08-21T16:10:00Z','2026-08-21T16:15:00Z')
on conflict(id) do nothing;

insert into public.maintenance_quotes(id,ticket_id,property_name,payer,descripcion,costo_proveedor,margen_pct,monto_final,status,created_at,updated_at)
values
('f2a40000-0000-4000-8200-000000000001','f2a40000-0000-4000-8100-000000000001','FASE2A-OP-EVENT-QA Managed','propietario','Fixture sintético',1000,30,1300,'aprobada','2026-08-21T16:02:00Z','2026-08-21T16:05:00Z'),
('f2a40000-0000-4000-8200-000000000002','f2a40000-0000-4000-8100-000000000002','FASE2A-OP-EVENT-QA External','propietario','Fixture sintético',2000,30,2600,'aprobada','2026-08-21T16:12:00Z','2026-08-21T16:15:00Z')
on conflict(id) do nothing;

insert into public.inmoadmin_operational_events(event_id,event_type,aggregate_type,aggregate_id,ticket_id,quote_id,property_id,maintenance_scope,occurred_at,payload_safe,idempotency_key)
values
('f2a40000-0000-4000-8300-000000000001','maintenance_ticket_created','maintenance_ticket','f2a40000-0000-4000-8100-000000000001','f2a40000-0000-4000-8100-000000000001',null,'f2a30000-0000-4000-8100-000000000001','managed_property','2026-08-21T16:00:00Z','{"eventType":"maintenance_ticket_created","ticketId":"f2a40000-0000-4000-8100-000000000001","maintenanceScope":"managed_property","propertyId":"f2a30000-0000-4000-8100-000000000001","priority":"media","payer":"propietario","status":"nuevo","occurredAt":"2026-08-21T16:00:00Z"}','FASE2A-OP-EVENT-QA:ticket:managed'),
('f2a40000-0000-4000-8300-000000000002','maintenance_quote_approved','maintenance_quote','f2a40000-0000-4000-8200-000000000001','f2a40000-0000-4000-8100-000000000001','f2a40000-0000-4000-8200-000000000001','f2a30000-0000-4000-8100-000000000001','managed_property','2026-08-21T16:05:00Z','{"eventType":"maintenance_quote_approved","quoteId":"f2a40000-0000-4000-8200-000000000001","ticketId":"f2a40000-0000-4000-8100-000000000001","maintenanceScope":"managed_property","propertyId":"f2a30000-0000-4000-8100-000000000001","quoteStatus":"aprobada","ticketStatus":"aprobado","amount":1300,"providerCost":1000,"payer":"propietario","occurredAt":"2026-08-21T16:05:00Z"}','FASE2A-OP-EVENT-QA:quote:managed'),
('f2a40000-0000-4000-8300-000000000003','maintenance_ticket_created','maintenance_ticket','f2a40000-0000-4000-8100-000000000002','f2a40000-0000-4000-8100-000000000002',null,null,'external_job','2026-08-21T16:10:00Z','{"eventType":"maintenance_ticket_created","ticketId":"f2a40000-0000-4000-8100-000000000002","maintenanceScope":"external_job","workReference":"FASE2A-OP-EVENT-QA-EXT-01","priority":"media","payer":"propietario","status":"nuevo","occurredAt":"2026-08-21T16:10:00Z"}','FASE2A-OP-EVENT-QA:ticket:external'),
('f2a40000-0000-4000-8300-000000000004','maintenance_quote_approved','maintenance_quote','f2a40000-0000-4000-8200-000000000002','f2a40000-0000-4000-8100-000000000002','f2a40000-0000-4000-8200-000000000002',null,'external_job','2026-08-21T16:15:00Z','{"eventType":"maintenance_quote_approved","quoteId":"f2a40000-0000-4000-8200-000000000002","ticketId":"f2a40000-0000-4000-8100-000000000002","maintenanceScope":"external_job","workReference":"FASE2A-OP-EVENT-QA-EXT-01","quoteStatus":"aprobada","ticketStatus":"aprobado","amount":2600,"providerCost":2000,"payer":"propietario","occurredAt":"2026-08-21T16:15:00Z"}','FASE2A-OP-EVENT-QA:quote:external')
on conflict(idempotency_key) do nothing;

select public.process_operational_event(event_id) from public.inmoadmin_operational_events where idempotency_key like 'FASE2A-OP-EVENT-QA:%' order by occurred_at;
commit;
