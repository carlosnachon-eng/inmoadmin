-- DEV ONLY — cleanup exclusivo del namespace fijo FASE1-QA. NO EJECUTADO.
begin;

delete from public.administrative_case_actions where context_key like any(array['%f1000000-%','%f1200000-%','%f1300000-%','%f1500000-%','%f1a00000-%','%f1b00000-%']);
delete from public.administrative_case_controls where context_key like any(array['%f1000000-%','%f1200000-%','%f1300000-%','%f1500000-%','%f1a00000-%','%f1b00000-%']);
delete from public.operational_recurring_task_executions where task_id='f1b00000-0000-4000-8100-000000000001';
delete from public.operational_recurring_tasks where id='f1b00000-0000-4000-8100-000000000001';
delete from public.maintenance_quotes where id='f1400000-0000-4000-8100-000000000001';
delete from public.maintenance_tickets where id::text like 'f1300000-%';
delete from public.pagos_servicios where id::text like 'f1600000-%';
delete from public.servicios_inmueble where id::text like 'f1500000-%';
delete from public.property_expenses where id::text like 'f1700000-%';
delete from public.owner_payment_receipts where id::text like 'f1900000-%';
delete from public.owner_payments where id::text like 'f1800000-%';
delete from public.comisiones_admin where contract_id::text like 'f1100000-%';
delete from public.cash_movements where coalesce(description,'') like 'FASE1-QA%';
delete from public.payments where id::text like 'f1200000-%';
delete from public.contracts where id::text like 'f1100000-%';
delete from public.llaves where id::text like 'f1a00000-%';
delete from public.properties where id::text like 'f1000000-%';

commit;
