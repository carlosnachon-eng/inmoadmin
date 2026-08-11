-- DEV ONLY - Fase 2A.2-0C - dataset sintetico del Centro Operativo Administrativo.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- NUNCA ejecutar en Produccion.
-- UUID namespace QA: 2a220000-0000-4000-8000-0000000000xx.
-- No contiene personas, telefonos, emails, direcciones, documentos, Base64 ni comentarios.

begin;

insert into public.properties (id, name, status)
values ('2a220000-0000-4000-8000-000000000001', 'QA-2A2-PROPERTY-001', 'ocupada')
on conflict (id) do nothing;

insert into public.plantillas_inspeccion (id, nombre, tipo_inmueble)
values ('2a220000-0000-4000-8000-000000000002', 'QA-2A2-TEMPLATE-001', 'otro')
on conflict (id) do nothing;

-- Caso 1: renta vencida.
insert into public.contracts
  (id, property_id, start_date, end_date, status)
values
  ('2a220000-0000-4000-8000-000000000010',
   '2a220000-0000-4000-8000-000000000001',
   current_date - 180, current_date + 180, 'activo')
on conflict (id) do nothing;

insert into public.payments
  (id, contract_id, amount, due_date, status)
values
  ('2a220000-0000-4000-8000-000000000020',
   '2a220000-0000-4000-8000-000000000010',
   1000, current_date - 12, 'atrasado')
on conflict (id) do nothing;

-- Caso 2: renovacion proxima.
insert into public.contracts
  (id, property_id, start_date, end_date, status)
values
  ('2a220000-0000-4000-8000-000000000011',
   '2a220000-0000-4000-8000-000000000001',
   current_date - 355, current_date + 10, 'activo')
on conflict (id) do nothing;

-- Caso 3: mantenimiento urgente sin avance.
insert into public.maintenance_tickets
  (id, property_id, title, priority, status, payer, created_at, updated_at)
values
  ('2a220000-0000-4000-8000-000000000030',
   '2a220000-0000-4000-8000-000000000001',
   'QA-2A2-MAINT-URGENT', 'urgente', 'nuevo', 'inmobiliaria',
   now() - interval '5 days', now() - interval '4 days')
on conflict (id) do nothing;

-- Caso 4: cotizacion esperando respuesta del propietario.
insert into public.maintenance_tickets
  (id, property_id, title, priority, status, payer, created_at, updated_at)
values
  ('2a220000-0000-4000-8000-000000000031',
   '2a220000-0000-4000-8000-000000000001',
   'QA-2A2-MAINT-QUOTE', 'media', 'cotizado', 'propietario',
   now() - interval '3 days', now() - interval '2 days')
on conflict (id) do nothing;

insert into public.maintenance_quotes
  (id, ticket_id, payer, status, created_at, updated_at)
values
  ('2a220000-0000-4000-8000-000000000040',
   '2a220000-0000-4000-8000-000000000031',
   'propietario', 'pendiente', now() - interval '2 days', now() - interval '2 days')
on conflict (id) do nothing;

-- Casos 5 y 6: firma estancada y cita vencida.
insert into public.firmas
  (id, tipo, titulo, nombre_comprador, nombre_vendedor,
   fecha_apartado, etapa_actual, status, created_at, updated_at)
values
  ('2a220000-0000-4000-8000-000000000050',
   'arrendamiento', 'QA-2A2-SIGNATURE-STALLED',
   'QA-2A2-SUBJECT', 'QA-2A2-COUNTERPARTY',
   current_date - 5, 3, 'activo', now() - interval '5 days', now() - interval '4 days')
on conflict (id) do nothing;

insert into public.firma_etapas
  (id, firma_id, orden, clave, nombre, responsable, status, created_at)
values
  ('2a220000-0000-4000-8000-000000000051',
   '2a220000-0000-4000-8000-000000000050',
   3, 'qa_notaria', 'QA-2A2-STAGE-NOTARY', 'notaria', 'pendiente', now() - interval '4 days')
on conflict (id) do nothing;

insert into public.firmas_citas
  (id, firma_id, titulo, tipo, fecha, hora, created_at)
values
  ('2a220000-0000-4000-8000-000000000052',
   '2a220000-0000-4000-8000-000000000050',
   'QA-2A2-SIGNATURE-APPOINTMENT', 'firma_arrendamiento',
   current_date - 1, time '10:00', now() - interval '3 days')
on conflict (id) do nothing;

-- Casos 7 y 8: inspeccion pendiente y esperando autorizacion del propietario.
insert into public.inspecciones
  (id, inmueble_id, contrato_id, plantilla_id, estatus, fecha)
values
  ('2a220000-0000-4000-8000-000000000060',
   '2a220000-0000-4000-8000-000000000001',
   '2a220000-0000-4000-8000-000000000010',
   '2a220000-0000-4000-8000-000000000002',
   'pendiente_presupuesto', current_date),
  ('2a220000-0000-4000-8000-000000000061',
   '2a220000-0000-4000-8000-000000000001',
   '2a220000-0000-4000-8000-000000000010',
   '2a220000-0000-4000-8000-000000000002',
   'pendiente_autorizacion_propietario', current_date)
on conflict (id) do nothing;

-- Caso 9: solicitud con un documento faltante sintetico, sin documento ni PII.
insert into public.solicitudes_inquilino
  (id, status, ia_revision_manual, ia_analisis_documental, created_at, updated_at)
values
  ('2a220000-0000-4000-8000-000000000070',
   'en_revision', true,
   '{"documentos_fallidos":["identificacion_qa"]}'::jsonb,
   now() - interval '3 days', now() - interval '3 days')
on conflict (id) do nothing;

-- Caso 10: poliza proxima a vencer.
insert into public.poliza_expedientes
  (id, inquilino_id, status, status_expediente, fecha_vigencia, created_at, updated_at)
values
  ('2a220000-0000-4000-8000-000000000080',
   '2a220000-0000-4000-8000-000000000070',
   'activo', 'activo', current_date + 20, now() - interval '10 days', now() - interval '2 days')
on conflict (id) do nothing;

commit;
