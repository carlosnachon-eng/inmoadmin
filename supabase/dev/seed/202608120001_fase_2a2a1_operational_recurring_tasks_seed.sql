-- DEV ONLY - Fase 2A.2-A.1 - dataset sintético de tareas recurrentes.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- NUNCA ejecutar en Producción.
-- No contiene personas, teléfonos, emails, direcciones, evidencia ni documentos.

begin;

do $$
begin
  if not exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-000000000003' and active) then
    raise exception 'Falta responsable QA coord_operaciones activo';
  end if;
  if not exists (select 1 from public.properties where id = '2a220000-0000-4000-8000-000000000001') then
    raise exception 'Falta inmueble QA de Fase 2A.2';
  end if;
  if not exists (select 1 from public.condominios where id = '2a223000-0000-4000-8000-000000000001') then
    raise exception 'Falta condominio QA de Fase 2A.2';
  end if;
end;
$$;

insert into public.operational_recurring_tasks (
  id, task_key, title, category, responsible_profile_id, provider_name,
  property_id, condominium_id, recurrence_unit, recurrence_interval,
  recurrence_weekday, recurrence_month_day, due_time, timezone,
  next_due_at, lead_days, state, created_by, updated_by
)
values
  -- Limpieza semanal: para hoy.
  ('2a221000-0000-4000-8000-000000000001', 'qa:recurring:weekly-cleaning',
   'QA Limpieza semanal', 'limpieza', '00000000-0000-4000-8000-000000000003', 'QA-PROVIDER-CLEAN',
   null, '2a223000-0000-4000-8000-000000000001', 'week', 1,
   extract(dow from current_date)::integer, null, time '09:00', 'America/Mexico_City',
   ((current_date + time '09:00') at time zone 'America/Mexico_City'), 3, 'active',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),

  -- Jardinería cada 14 días: vencida.
  ('2a221000-0000-4000-8000-000000000002', 'qa:recurring:garden-14-days',
   'QA Jardinería cada 14 días', 'jardineria', '00000000-0000-4000-8000-000000000003', 'QA-PROVIDER-GARDEN',
   null, '2a223000-0000-4000-8000-000000000001', 'day', 14,
   null, null, time '08:00', 'America/Mexico_City',
   (((current_date - 10) + time '08:00') at time zone 'America/Mexico_City'), 5, 'active',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),

  -- Fumigación trimestral: próxima.
  ('2a221000-0000-4000-8000-000000000003', 'qa:recurring:quarterly-fumigation',
   'QA Fumigación trimestral', 'fumigacion', '00000000-0000-4000-8000-000000000003', 'QA-PROVIDER-FUMIGATION',
   null, '2a223000-0000-4000-8000-000000000001', 'month', 3,
   null, extract(day from current_date + 5)::integer, time '10:00', 'America/Mexico_City',
   (((current_date + 5) + time '10:00') at time zone 'America/Mexico_City'), 10, 'active',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),

  -- Cisterna semestral: fuera de anticipación.
  ('2a221000-0000-4000-8000-000000000004', 'qa:recurring:semiannual-cistern',
   'QA Limpieza semestral de cisterna', 'limpieza_agua', '00000000-0000-4000-8000-000000000003', null,
   null, '2a223000-0000-4000-8000-000000000001', 'month', 6,
   null, extract(day from current_date + 60)::integer, time '09:30', 'America/Mexico_City',
   (((current_date + 60) + time '09:30') at time zone 'America/Mexico_City'), 15, 'active',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),

  -- Supervisión cada X días: próxima.
  ('2a221000-0000-4000-8000-000000000005', 'qa:recurring:supervision-5-days',
   'QA Supervisión cada 5 días', 'supervision', '00000000-0000-4000-8000-000000000003', null,
   '2a220000-0000-4000-8000-000000000001', null, 'day', 5,
   null, null, time '12:00', 'America/Mexico_City',
   (((current_date + 2) + time '12:00') at time zone 'America/Mexico_City'), 4, 'active',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),

  -- Mensual día 31; meses cortos usan último día y luego recuperan 31.
  ('2a221000-0000-4000-8000-000000000006', 'qa:recurring:monthly-day-31',
   'QA Revisión mensual día 31', 'revision_equipo', '00000000-0000-4000-8000-000000000003', null,
   '2a220000-0000-4000-8000-000000000001', null, 'month', 1,
   null, 31, time '11:00', 'America/Mexico_City',
   (((date_trunc('month', current_date) + interval '1 month - 1 day')::date + time '11:00') at time zone 'America/Mexico_City'),
   31, 'active', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),

  -- Mantenimiento preventivo próximo.
  ('2a221000-0000-4000-8000-000000000007', 'qa:recurring:preventive-upcoming',
   'QA Mantenimiento preventivo', 'mantenimiento_preventivo', '00000000-0000-4000-8000-000000000003', null,
   '2a220000-0000-4000-8000-000000000001', null, 'day', 30,
   null, null, time '15:00', 'America/Mexico_City',
   (((current_date + 3) + time '15:00') at time zone 'America/Mexico_City'), 7, 'active',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),

  -- Suspendida: no aparece.
  ('2a221000-0000-4000-8000-000000000008', 'qa:recurring:suspended',
   'QA Tarea suspendida', 'limpieza', '00000000-0000-4000-8000-000000000003', null,
   '2a220000-0000-4000-8000-000000000001', null, 'day', 7,
   null, null, time '09:00', 'America/Mexico_City',
   (((current_date - 2) + time '09:00') at time zone 'America/Mexico_City'), 3, 'suspended',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),

  -- Desactivada: no aparece.
  ('2a221000-0000-4000-8000-000000000009', 'qa:recurring:disabled',
   'QA Tarea desactivada', 'pago_servicio', '00000000-0000-4000-8000-000000000003', null,
   '2a220000-0000-4000-8000-000000000001', null, 'month', 1,
   null, extract(day from current_date)::integer, time '10:00', 'America/Mexico_City',
   ((current_date + time '10:00') at time zone 'America/Mexico_City'), 5, 'disabled',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),

  -- Responsable posteriormente inactivo: el test desactiva el perfil dentro de ROLLBACK.
  ('2a221000-0000-4000-8000-000000000010', 'qa:recurring:inactive-responsible',
   'QA Responsable posteriormente inactivo', 'supervision', '00000000-0000-4000-8000-000000000003', null,
   '2a220000-0000-4000-8000-000000000001', null, 'day', 10,
   null, null, time '13:00', 'America/Mexico_City',
   ((current_date + time '13:00') at time zone 'America/Mexico_City'), 2, 'active',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),

  -- Varias ocurrencias vencidas: completar salta a la primera futura.
  ('2a221000-0000-4000-8000-000000000011', 'qa:recurring:multiple-overdue',
   'QA Varias ocurrencias vencidas', 'revision_equipo', '00000000-0000-4000-8000-000000000003', null,
   '2a220000-0000-4000-8000-000000000001', null, 'day', 7,
   null, null, time '07:00', 'America/Mexico_City',
   (((current_date - 35) + time '07:00') at time zone 'America/Mexico_City'), 5, 'active',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),

  -- Revisión semanal adicional para validar weekday.
  ('2a221000-0000-4000-8000-000000000012', 'qa:recurring:weekly-equipment',
   'QA Revisión semanal de equipo', 'revision_equipo', '00000000-0000-4000-8000-000000000003', null,
   null, '2a223000-0000-4000-8000-000000000001', 'week', 1,
   extract(dow from current_date + 1)::integer, null, time '16:00', 'America/Mexico_City',
   (((current_date + 1) + time '16:00') at time zone 'America/Mexico_City'), 2, 'active',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

update public.operational_recurring_tasks set
  suspended_at = now() - interval '1 day',
  suspended_by = '00000000-0000-4000-8000-000000000001',
  suspension_reason = 'QA suspensión controlada'
where id = '2a221000-0000-4000-8000-000000000008';

update public.operational_recurring_tasks set
  disabled_at = now() - interval '1 day',
  disabled_by = '00000000-0000-4000-8000-000000000001',
  disable_reason = 'QA desactivación controlada'
where id = '2a221000-0000-4000-8000-000000000009';

commit;
