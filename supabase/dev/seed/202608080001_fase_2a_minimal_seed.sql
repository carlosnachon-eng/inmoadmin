-- Fase 2A Gerencia de Ventas - seed minimo sintetico para DEV/PREVIEW
-- Estado: NO EJECUTADO.
-- Uso: ejecutar solo despues de aplicar la migracion base en Supabase DEV.
--
-- Este seed no contiene datos reales y no debe ejecutarse en Produccion.
-- No depende de usuarios Auth: los campos que referencian auth.users se cargan
-- como null. Para pruebas RLS con login real, crea despues usuarios Auth de
-- prueba en Supabase DEV y ajusta los UUID de `profiles.id` para que coincidan
-- con auth.users.id.

begin;

insert into public.roles (id, nombre, descripcion, es_externo)
values
  ('admin', 'Administrador', 'Acceso administrativo interno', false),
  ('gerente_ventas', 'Gerente de Ventas', 'Supervision comercial', false),
  ('coord_operaciones', 'Coordinadora de Operaciones', 'Coordinacion operativa', false),
  ('asesor', 'Asesor de Ventas', 'Asesor comercial', false)
on conflict (id) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  es_externo = excluded.es_externo;

insert into public.profiles (id, email, full_name, role, role_id, active)
values
  ('00000000-0000-4000-8000-000000000001', 'admin.dev@emporio.test', 'Admin Dev', 'admin', 'admin', true),
  ('00000000-0000-4000-8000-000000000002', 'guillermo.dev@emporio.test', 'Guillermo Dev', 'admin', 'gerente_ventas', true),
  ('00000000-0000-4000-8000-000000000003', 'coord.dev@emporio.test', 'Coordinadora Dev', 'coord_operaciones', 'coord_operaciones', true),
  ('00000000-0000-4000-8000-000000000011', 'ari.dev@emporio.test', 'Ari Dev', 'asesor', 'asesor', true),
  ('00000000-0000-4000-8000-000000000012', 'andrea.dev@emporio.test', 'Andrea Dev', 'asesor', 'asesor', true),
  ('00000000-0000-4000-8000-000000000013', 'rosario.dev@emporio.test', 'Rosario Dev', 'asesor', 'asesor', true),
  ('00000000-0000-4000-8000-000000000014', 'ivan.dev@emporio.test', 'Ivan Dev', 'asesor', 'asesor', true),
  ('00000000-0000-4000-8000-000000000015', 'amanda.dev@emporio.test', 'Amanda Dev', 'asesor', 'asesor', true)
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  role = excluded.role,
  role_id = excluded.role_id,
  active = excluded.active;

insert into public.permisos_modulo (role_id, modulo, puede_ver, puede_editar, alcance)
values
  ('admin', 'ejecutivo', true, true, 'global'),
  ('gerente_ventas', 'ejecutivo', true, true, 'equipo'),
  ('coord_operaciones', 'ejecutivo', true, false, 'asignado'),
  ('asesor', 'ejecutivo', false, false, 'propio')
on conflict do nothing;

insert into public.gv_supervision_edges
  (id, supervisor_profile_id, subordinate_profile_id, scope, starts_on, active, notes, created_by)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000011', 'ventas', '2026-08-01', true, 'Gerente supervisa asesor Dev', null),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000012', 'ventas', '2026-08-01', true, 'Gerente supervisa asesor Dev', null),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000013', 'ventas', '2026-08-01', true, 'Gerente supervisa asesor Dev', null),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000014', 'ventas', '2026-08-01', true, 'Gerente supervisa asesor Dev', null),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000015', 'operaciones', '2026-08-01', true, 'Coordinacion supervisa ambito asignado Dev', null)
on conflict (id) do nothing;

insert into public.gv_advisor_availability
  (id, profile_id, starts_on, ends_on, status, capacity_weight, reason, notes, created_by)
values
  ('11000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '2026-08-01', null, 'evaluable', 1, 'Activo Dev', null, null),
  ('11000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000012', '2026-08-01', '2026-08-15', 'ausencia_temporal', 0, 'Ausencia temporal Dev', 'Caso para validar capacidad disponible', null),
  ('11000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000013', '2026-08-01', '2026-08-20', 'fuera_temporal', 0, 'Fuera temporal Dev', 'Caso para validar exclusion evaluable', null),
  ('11000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000014', '2026-08-01', null, 'evaluable', 1, 'Activo Dev', null, null),
  ('11000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000015', '2026-08-01', null, 'evaluable', 1, 'Activo Dev', null, null)
on conflict (id) do nothing;

insert into public.clientes (id, nombre, telefono, correo, etapa_interes, notas, asesor_id)
values
  ('20000000-0000-4000-8000-000000000001', 'Cliente Uno Dev', '2221000001', 'cliente.uno@dev.test', 'interesado', 'Dato sintetico', '00000000-0000-4000-8000-000000000011'),
  ('20000000-0000-4000-8000-000000000002', 'Cliente Dos Dev', '2221000002', 'cliente.dos@dev.test', 'cita', 'Dato sintetico', '00000000-0000-4000-8000-000000000011'),
  ('20000000-0000-4000-8000-000000000003', 'Cliente Tres Dev', '2221000003', 'cliente.tres@dev.test', 'oferta', 'Dato sintetico', '00000000-0000-4000-8000-000000000014'),
  ('20000000-0000-4000-8000-000000000004', 'Cliente Cuatro Dev', '2221000004', 'cliente.cuatro@dev.test', 'perdido', 'Dato sintetico', '00000000-0000-4000-8000-000000000015')
on conflict (id) do update set
  nombre = excluded.nombre,
  telefono = excluded.telefono,
  correo = excluded.correo,
  etapa_interes = excluded.etapa_interes,
  notas = excluded.notas,
  asesor_id = excluded.asesor_id;

insert into public.propiedades
  (id, public_id, titulo, descripcion, operacion, precio, moneda, unidad_precio, tipo, direccion, colonia, ciudad, estado, status, agente_id, origen)
values
  ('30000000-0000-4000-8000-000000000001', 'DEV-GV-001', 'Casa Dev San Andres', 'Propiedad sintetica para venta', 'venta', 3200000, 'MXN', 'total', 'casa', 'Direccion ficticia 1', 'Centro', 'San Andres Cholula', 'Puebla', 'published', '00000000-0000-4000-8000-000000000011', 'seed_dev'),
  ('30000000-0000-4000-8000-000000000002', 'DEV-GV-002', 'Departamento Dev Cholula', 'Propiedad sintetica para renta', 'renta', 18000, 'MXN', 'total', 'departamento', 'Direccion ficticia 2', 'Zerezotla', 'San Pedro Cholula', 'Puebla', 'published', '00000000-0000-4000-8000-000000000014', 'seed_dev'),
  ('30000000-0000-4000-8000-000000000003', 'DEV-GV-003', 'Casa Renovacion Dev', 'Propiedad sintetica para renovacion', 'renta', 22000, 'MXN', 'total', 'casa', 'Direccion ficticia 3', 'La Carcana', 'San Pedro Cholula', 'Puebla', 'apartada', '00000000-0000-4000-8000-000000000015', 'seed_dev')
on conflict (id) do update set
  public_id = excluded.public_id,
  titulo = excluded.titulo,
  descripcion = excluded.descripcion,
  operacion = excluded.operacion,
  precio = excluded.precio,
  moneda = excluded.moneda,
  unidad_precio = excluded.unidad_precio,
  tipo = excluded.tipo,
  direccion = excluded.direccion,
  colonia = excluded.colonia,
  ciudad = excluded.ciudad,
  estado = excluded.estado,
  status = excluded.status,
  agente_id = excluded.agente_id,
  origen = excluded.origen;

insert into public.citas (id, cliente_id, propiedad_id, asesor_id, fecha_hora, estado, notas, confirmacion_estado, confirmacion_actualizada_at)
values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '2026-08-05 17:00:00-06', 'efectiva', 'Cita sintetica efectiva', 'realizada', now()),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '2026-08-08 12:00:00-06', 'agendada', 'Cita sintetica agendada', 'pendiente_confirmar', now()),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000014', '2026-08-06 11:00:00-06', 'efectiva', 'Cita sintetica calificada', 'realizada', now())
on conflict (id) do update set
  cliente_id = excluded.cliente_id,
  propiedad_id = excluded.propiedad_id,
  asesor_id = excluded.asesor_id,
  fecha_hora = excluded.fecha_hora,
  estado = excluded.estado,
  notas = excluded.notas,
  confirmacion_estado = excluded.confirmacion_estado,
  confirmacion_actualizada_at = excluded.confirmacion_actualizada_at;

insert into public.seguimientos_cliente (id, cliente_id, asesor_id, nota, tipo, created_at)
values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', 'Seguimiento sintetico por WhatsApp', 'whatsapp', '2026-08-05 18:00:00-06'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000014', 'Seguimiento sintetico de oferta', 'llamada', '2026-08-06 13:00:00-06')
on conflict (id) do nothing;

insert into public.cierres
  (id, anio, mes, mes_nombre, propiedad, fecha_cierre, operacion, precio, comision, cobrado, pendiente, vendedor, com_vendedor, pag_vendedor, pend_vend, comision_inmobiliaria, advisor_profile_id, operation_type_structured, operation_type_confidence, operation_type_source, classified_by, classified_at, classification_notes)
values
  ('60000000-0000-4000-8000-000000000001', 2026, 8, 'Agosto', 'Casa Dev San Andres', '2026-08-07', 'Venta', 3200000, 96000, 96000, 0, 'Ari Dev', 38400, 0, 38400, 57600, '00000000-0000-4000-8000-000000000011', 'nueva', 'manual_confirmed', 'seed_dev', null, now(), 'Cierre nuevo sintetico'),
  ('60000000-0000-4000-8000-000000000002', 2026, 8, 'Agosto', 'Casa Renovacion Dev', '2026-08-09', 'Renta', 22000, 11000, 11000, 0, 'Amanda Dev', 4400, 0, 4400, 6600, '00000000-0000-4000-8000-000000000015', 'renovacion', 'manual_confirmed', 'seed_dev', null, now(), 'Renovacion sintetica fuera de meta nueva')
on conflict (id) do update set
  advisor_profile_id = excluded.advisor_profile_id,
  operation_type_structured = excluded.operation_type_structured,
  operation_type_confidence = excluded.operation_type_confidence,
  operation_type_source = excluded.operation_type_source,
  classified_by = excluded.classified_by,
  classified_at = excluded.classified_at,
  classification_notes = excluded.classification_notes;

insert into public.gv_opportunities
  (id, title, cliente_id, propiedad_id, asesor_id, stage, operation_type, forecast_category, probability_pct, estimated_price, estimated_commission, expected_close_date, next_action, next_action_at, risk_level, risk_reason, qualified_at, closed_at, cierre_id, lost_reason, lost_reason_category, offer_amount, apartado_amount, source, source_external_id, respond_contact_id, respond_conversation_id, respond_channel, respond_assignee_id, respond_status, respond_first_activity_at, respond_last_inbound_at, respond_last_outbound_at, last_activity_at, notes, created_by, updated_by)
values
  ('70000000-0000-4000-8000-000000000001', 'Venta Casa Dev San Andres', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', 'cierre_ganado', 'nueva', 'commit', 100, 3200000, 96000, '2026-08-07', 'Enviar agradecimiento y pedir referido', '2026-08-10 10:00:00-06', 'bajo', null, '2026-08-05 18:00:00-06', '2026-08-07 17:00:00-06', '60000000-0000-4000-8000-000000000001', null, null, 3150000, 50000, 'manual', null, null, null, null, null, null, null, null, null, '2026-08-07 17:00:00-06', 'Oportunidad nueva ganada', null, null),
  ('70000000-0000-4000-8000-000000000002', 'Renta Departamento Dev Cholula', '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000014', 'oferta', 'nueva', 'best_case', 65, 18000, 18000, '2026-08-20', 'Negociar condiciones de renta', '2026-08-09 13:00:00-06', 'normal', null, '2026-08-06 13:00:00-06', null, null, null, null, 17000, null, 'respond_io', 'respond-dev-001', 'contact-dev-001', 'conversation-dev-001', 'whatsapp', 'assignee-dev-ivan', 'open', '2026-08-04 09:00:00-06', '2026-08-08 09:30:00-06', '2026-08-08 09:45:00-06', '2026-08-08 09:45:00-06', 'Oportunidad con metadatos Respond.io sinteticos', null, null),
  ('70000000-0000-4000-8000-000000000003', 'Renovacion Casa Dev', null, '30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000015', 'cierre_ganado', 'renovacion', 'commit', 100, 22000, 11000, '2026-08-09', 'Archivar renovacion', '2026-08-12 10:00:00-06', 'bajo', null, null, '2026-08-09 16:00:00-06', '60000000-0000-4000-8000-000000000002', null, null, null, null, 'manual', null, null, null, null, null, null, null, null, null, '2026-08-09 16:00:00-06', 'Renovacion separada de produccion nueva', null, null),
  ('70000000-0000-4000-8000-000000000004', 'Cliente perdido por credito Dev', '20000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000015', 'cierre_perdido', 'nueva', 'omitido', 0, 3200000, 96000, '2026-08-18', 'Sin siguiente accion', null, 'alto', 'Cliente no califico credito', null, null, null, 'No califico credito hipotecario', 'credito', null, null, 'manual', null, null, null, null, null, null, null, null, null, '2026-08-08 12:00:00-06', 'Operacion perdida sintetica', null, null)
on conflict (id) do update set
  stage = excluded.stage,
  operation_type = excluded.operation_type,
  forecast_category = excluded.forecast_category,
  probability_pct = excluded.probability_pct,
  estimated_price = excluded.estimated_price,
  estimated_commission = excluded.estimated_commission,
  expected_close_date = excluded.expected_close_date,
  next_action = excluded.next_action,
  next_action_at = excluded.next_action_at,
  risk_level = excluded.risk_level,
  risk_reason = excluded.risk_reason,
  updated_by = excluded.updated_by,
  updated_at = now();

insert into public.gv_opportunity_events
  (id, opportunity_id, event_type, field_name, old_value, new_value, occurred_at, actor_profile_id, acted_as_profile_id, is_management_intervention, event_source, metadata, notes)
values
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'created', null, null, '{"stage":"lead"}', '2026-08-05 18:00:00-06', '00000000-0000-4000-8000-000000000011', null, false, 'app', '{}', 'Creacion sintetica'),
  ('80000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', 'stage_changed', 'stage', '{"stage":"apartado"}', '{"stage":"cierre_ganado"}', '2026-08-07 17:00:00-06', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000011', true, 'app', '{"reason":"Validacion gerencial de cierre"}', 'Guillermo Dev interviene sin impersonar asesor'),
  ('80000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000002', 'external_sync', null, null, '{"respond_contact_id":"contact-dev-001","respond_conversation_id":"conversation-dev-001"}', '2026-08-08 09:45:00-06', '00000000-0000-4000-8000-000000000014', null, false, 'respond_io_sync', '{"sync_mode":"metadata_only"}', 'Sin contenido de mensajes'),
  ('80000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000004', 'lost_reason_classified', 'lost_reason_category', null, '{"lost_reason_category":"credito"}', '2026-08-08 12:00:00-06', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000015', true, 'app', '{}', 'Clasificacion de perdida por Gerencia')
on conflict (id) do nothing;

commit;
