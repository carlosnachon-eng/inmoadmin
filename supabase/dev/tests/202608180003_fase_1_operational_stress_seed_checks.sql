-- READ-ONLY — ejecutar sólo después del seed FASE1-QA. NO EJECUTADO.
select 'properties' scenario, count(*) actual, 4 expected from public.properties where id::text like 'f1000000-%'
union all select 'contracts',count(*),4 from public.contracts where id::text like 'f1100000-%'
union all select 'rent_payments',count(*),5 from public.payments where id::text like 'f1200000-%'
union all select 'maintenance_tickets',count(*),5 from public.maintenance_tickets where id::text like 'f1300000-%'
union all select 'maintenance_quotes',count(*),1 from public.maintenance_quotes where id::text like 'f1400000-%'
union all select 'services',count(*),7 from public.servicios_inmueble where id::text like 'f1500000-%'
union all select 'service_payments',count(*),4 from public.pagos_servicios where id::text like 'f1600000-%'
union all select 'property_expenses',count(*),1 from public.property_expenses where id::text like 'f1700000-%'
union all select 'owner_payments',count(*),1 from public.owner_payments where id::text like 'f1800000-%'
union all select 'owner_receipts',count(*),2 from public.owner_payment_receipts where id::text like 'f1900000-%'
union all select 'keys',count(*),4 from public.llaves where id::text like 'f1a00000-%'
union all select 'recurring_tasks',count(*),1 from public.operational_recurring_tasks where id::text like 'f1b00000-%'
order by scenario;

select scenario, present from (values
 ('servicio_mensual_proximo', exists(select 1 from public.pagos_servicios where id='f1600000-0000-4000-8100-000000000001' and fecha_limite>current_date)),
 ('servicio_mensual_vencido', exists(select 1 from public.pagos_servicios where id='f1600000-0000-4000-8100-000000000002' and fecha_limite<current_date)),
 ('servicio_comprobante_revision', exists(select 1 from public.pagos_servicios where id='f1600000-0000-4000-8100-000000000003' and status='en_revision' and comprobante_url is not null)),
 ('cfe_bimestral_sin_ancla', exists(select 1 from public.servicios_inmueble where id='f1500000-0000-4000-8100-000000000004' and periodicidad='bimestral')),
 ('predial_anual_sin_ancla', exists(select 1 from public.servicios_inmueble where id='f1500000-0000-4000-8100-000000000005' and periodicidad='anual')),
 ('gas_recarga', exists(select 1 from public.servicios_inmueble where id='f1500000-0000-4000-8100-000000000006' and periodicidad='recarga')),
 ('servicio_emporio_con_gasto', exists(select 1 from public.pagos_servicios where id='f1600000-0000-4000-8100-000000000007' and gasto_id='f1700000-0000-4000-8100-000000000001')),
 ('renta_emporio', exists(select 1 from public.payments where id='f1200000-0000-4000-8100-000000000001' and recibido_por='emporio')),
 ('renta_directa_propietario', exists(select 1 from public.payments where id='f1200000-0000-4000-8100-000000000002' and recibido_por='propietario')),
 ('liquidacion_parcial', exists(select 1 from public.owner_payments where id='f1800000-0000-4000-8100-000000000001' and status='pagado_parcial')),
 ('ticket_urgente', exists(select 1 from public.maintenance_tickets where id='f1300000-0000-4000-8100-000000000001' and priority='urgente')),
 ('ticket_estancado', exists(select 1 from public.maintenance_tickets where id='f1300000-0000-4000-8100-000000000002' and updated_at<now()-interval '24 hours')),
 ('cotizacion_esperando', exists(select 1 from public.maintenance_quotes where id='f1400000-0000-4000-8100-000000000001' and status='pendiente')),
 ('mantenimiento_descuento_anterior', exists(select 1 from public.maintenance_tickets where id='f1300000-0000-4000-8100-000000000004' and payer='propietario' and not descontado_de_liquidacion)),
 ('ticket_cerrado_sin_ruido', exists(select 1 from public.maintenance_tickets where id='f1300000-0000-4000-8100-000000000005' and status='cerrado')),
 ('llave_resguardo', exists(select 1 from public.llaves where id='f1a00000-0000-4000-8100-000000000001' and en_resguardo)),
 ('llave_fuera_menos_un_dia', exists(select 1 from public.llaves where id='f1a00000-0000-4000-8100-000000000002' and fecha_prestamo>now()-interval '1 day')),
 ('llave_fuera_un_dia', exists(select 1 from public.llaves where id='f1a00000-0000-4000-8100-000000000003' and fecha_prestamo<now()-interval '1 day')),
 ('llave_fuera_tres_dias', exists(select 1 from public.llaves where id='f1a00000-0000-4000-8100-000000000004' and fecha_prestamo<now()-interval '3 days')),
 ('renta_atrasada', exists(select 1 from public.payments where id='f1200000-0000-4000-8100-000000000004' and status='atrasado' and receipt_url is null)),
 ('renta_comprobante_revision', exists(select 1 from public.payments where id='f1200000-0000-4000-8100-000000000005' and status='en_revision' and receipt_url is not null)),
 ('transferencia_sin_evidencia', exists(select 1 from public.owner_payment_receipts where id='f1900000-0000-4000-8100-000000000001' and forma_pago='transferencia' and comprobante_url is null)),
 ('efectivo_sin_firma', exists(select 1 from public.owner_payment_receipts where id='f1900000-0000-4000-8100-000000000002' and forma_pago='efectivo' and firma_url is null)),
 ('contrato_proximo_vencer', exists(select 1 from public.contracts where id='f1100000-0000-4000-8100-000000000004' and end_date between current_date and current_date+30)),
 ('tarea_recurrente_proxima', exists(select 1 from public.operational_recurring_tasks where id='f1b00000-0000-4000-8100-000000000001' and state='active'))
) as checks(scenario,present)
order by scenario;
