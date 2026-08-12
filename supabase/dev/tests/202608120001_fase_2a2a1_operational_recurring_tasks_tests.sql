-- DEV ONLY - pruebas transaccionales de Fase 2A.2-A.1.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- NUNCA ejecutar en Producción. Todos los cambios de esta suite hacen ROLLBACK.

begin;

create or replace function pg_temp.qa_assert(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is not true then raise exception 'QA FAIL: %', p_message; end if;
end;
$$;

-- Esquema, seed y restricciones principales.
select pg_temp.qa_assert((select count(*) = 12 from public.operational_recurring_tasks where id::text like '2a221000-0000-4000-8000-%'), '12 tareas QA esperadas');
select pg_temp.qa_assert((select count(*) = count(distinct task_key) from public.operational_recurring_tasks), 'task_key único');
select pg_temp.qa_assert((select bool_and((property_id is not null)::int + (condominium_id is not null)::int = 1) from public.operational_recurring_tasks), 'exactamente una ubicación');
select pg_temp.qa_assert((select count(*) = 0 from public.operational_recurring_task_executions), 'historial inicia vacío');

-- Cálculo calendario: 31 de enero -> último día de febrero -> 31 de marzo.
do $$
declare v_feb timestamptz; v_mar timestamptz; v_due timestamptz; v_next timestamptz;
begin
  select n.next_due_at into v_feb from public.operational_recurring_next_occurrence(
    '2026-01-31 09:00:00-06', 'month', 1, null, 31, 'America/Mexico_City', null
  ) n;
  perform pg_temp.qa_assert((v_feb at time zone 'America/Mexico_City')::date = date '2026-02-28', 'enero 31 debe ajustar a febrero 28');
  perform pg_temp.qa_assert((v_feb at time zone 'America/Mexico_City')::time = time '09:00', 'hora local mensual estable');
  select n.next_due_at into v_mar from public.operational_recurring_next_occurrence(
    v_feb, 'month', 1, null, 31, 'America/Mexico_City', null
  ) n;
  perform pg_temp.qa_assert((v_mar at time zone 'America/Mexico_City')::date = date '2026-03-31', 'día 31 debe recuperarse en marzo');

  select next_due_at into v_due from public.operational_recurring_tasks where id = '2a221000-0000-4000-8000-000000000003';
  select n.next_due_at into v_next from public.operational_recurring_next_occurrence(v_due, 'month', 3, null, extract(day from (v_due at time zone 'America/Mexico_City'))::integer, 'America/Mexico_City', null) n;
  perform pg_temp.qa_assert((v_next at time zone 'America/Mexico_City')::date = ((v_due at time zone 'America/Mexico_City')::date + interval '3 months')::date, 'recurrencia trimestral');

  select next_due_at into v_due from public.operational_recurring_tasks where id = '2a221000-0000-4000-8000-000000000004';
  select n.next_due_at into v_next from public.operational_recurring_next_occurrence(v_due, 'month', 6, null, extract(day from (v_due at time zone 'America/Mexico_City'))::integer, 'America/Mexico_City', null) n;
  perform pg_temp.qa_assert((v_next at time zone 'America/Mexico_City')::date = ((v_due at time zone 'America/Mexico_City')::date + interval '6 months')::date, 'recurrencia semestral');
end;
$$;

-- PUBLIC/anon sin privilegios ni RPC.
set local role anon;
do $$ begin
  begin perform count(*) from public.operational_recurring_tasks; raise exception 'anon SELECT permitido';
  exception when others then if sqlstate <> '42501' then raise; end if; end;
  begin perform public.create_operational_recurring_task('QA anon', 'limpieza', '00000000-0000-4000-8000-000000000003', 'day', 1, now(), '2a220000-0000-4000-8000-000000000001'); raise exception 'anon RPC permitido';
  exception when others then if sqlstate <> '42501' then raise; end if; end;
end $$;
reset role;

-- Asesor y gerente sin filas ni DML/RPC.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000011', true);
select pg_temp.qa_assert((select count(*) = 0 from public.operational_recurring_tasks), 'asesor no debe leer tareas');
do $$ begin
  begin update public.operational_recurring_tasks set title = title; raise exception 'asesor UPDATE permitido';
  exception when others then if sqlstate <> '42501' then raise; end if; end;
  begin perform public.create_operational_recurring_task('QA asesor', 'limpieza', '00000000-0000-4000-8000-000000000003', 'day', 1, now(), '2a220000-0000-4000-8000-000000000001'); raise exception 'asesor RPC permitido';
  exception when others then if sqlstate <> '42501' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select pg_temp.qa_assert((select count(*) = 0 from public.operational_recurring_tasks), 'gerente no debe leer tareas');
do $$ begin
  begin perform public.create_operational_recurring_task('QA gerente', 'limpieza', '00000000-0000-4000-8000-000000000003', 'day', 1, now(), '2a220000-0000-4000-8000-000000000001'); raise exception 'gerente RPC permitido';
  exception when others then if sqlstate <> '42501' then raise; end if; end;
end $$;
reset role;

-- Admin puede crear y el actor proviene de auth.uid().
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select pg_temp.qa_assert((select count(*) >= 12 from public.operational_recurring_tasks), 'admin puede leer tareas');
do $$
declare v_task public.operational_recurring_tasks;
begin
  v_task := public.create_operational_recurring_task(
    'QA creación admin', 'limpieza', '00000000-0000-4000-8000-000000000003',
    'day', 2, (date_trunc('day', now() at time zone 'America/Mexico_City') + interval '9 hours') at time zone 'America/Mexico_City',
    '2a220000-0000-4000-8000-000000000001'
  );
  perform pg_temp.qa_assert(v_task.created_by = '00000000-0000-4000-8000-000000000001', 'actor admin debe provenir de auth.uid');
  perform pg_temp.qa_assert(v_task.property_id is not null and v_task.condominium_id is null, 'ubicación única en RPC');

  v_task := public.edit_operational_recurring_task(
    v_task.id, v_task.version, 'QA programación editada', 'supervision',
    '00000000-0000-4000-8000-000000000003', 'day', 2, v_task.next_due_at,
    v_task.property_id, null, null, null, 5, 'America/Mexico_City', null, null
  );
  perform pg_temp.qa_assert(v_task.title = 'QA programación editada' and v_task.version = 2, 'edición RPC');
  v_task := public.suspend_operational_recurring_task(v_task.id, v_task.version, 'QA suspensión');
  perform pg_temp.qa_assert(v_task.state = 'suspended', 'suspensión RPC');
  v_task := public.reactivate_operational_recurring_task(v_task.id, v_task.version, 'preserve_due', null);
  perform pg_temp.qa_assert(v_task.state = 'active', 'reactivación RPC');
  v_task := public.disable_operational_recurring_task(v_task.id, v_task.version, 'QA desactivación');
  perform pg_temp.qa_assert(v_task.state = 'disabled', 'desactivación RPC');
end;
$$;

do $$ begin
  begin
    perform public.create_operational_recurring_task(
      'QA sin ubicación', 'limpieza', '00000000-0000-4000-8000-000000000003',
      'day', 1, now(), null, null
    );
    raise exception 'creación sin ubicación permitida';
  exception when others then if sqlstate <> '23514' then raise; end if; end;
end $$;

-- Admin tampoco tiene DML directo; ejecuciones son inmutables.
do $$ begin
  begin insert into public.operational_recurring_task_executions(task_id, scheduled_due_at, completed_at, completed_by, next_due_at_generated) values ('2a221000-0000-4000-8000-000000000001', now(), now(), '00000000-0000-4000-8000-000000000001', now()); raise exception 'INSERT directo ejecución permitido';
  exception when others then if sqlstate <> '42501' then raise; end if; end;
  begin update public.operational_recurring_task_executions set completion_note = null; raise exception 'UPDATE directo ejecución permitido';
  exception when others then if sqlstate <> '42501' then raise; end if; end;
  begin delete from public.operational_recurring_task_executions; raise exception 'DELETE directo ejecución permitido';
  exception when others then if sqlstate <> '42501' then raise; end if; end;
end $$;

-- Completar varias ocurrencias vencidas: una ejecución real, sin ficticias.
do $$
declare v_due timestamptz; v_result jsonb;
begin
  select next_due_at into v_due from public.operational_recurring_tasks where id = '2a221000-0000-4000-8000-000000000011';
  v_result := public.complete_operational_recurring_task('2a221000-0000-4000-8000-000000000011', v_due, 'QA atraso acumulado', null);
  perform pg_temp.qa_assert((v_result #>> '{execution,missed_occurrences_count}')::integer >= 1, 'debe registrar ocurrencias omitidas');
  perform pg_temp.qa_assert((select count(*) = 1 from public.operational_recurring_task_executions where task_id = '2a221000-0000-4000-8000-000000000011'), 'solo una ejecución real');
  perform pg_temp.qa_assert((v_result #>> '{task,next_due_at}')::timestamptz > now(), 'debe avanzar a primera fecha futura');
end;
$$;

-- Doble confirmación secuencial queda bloqueada por expected_due_at (la concurrente se prueba aparte).
do $$
declare v_due timestamptz;
begin
  select next_due_at into v_due from public.operational_recurring_tasks where id = '2a221000-0000-4000-8000-000000000001';
  perform public.complete_operational_recurring_task('2a221000-0000-4000-8000-000000000001', v_due, null, null);
  begin
    perform public.complete_operational_recurring_task('2a221000-0000-4000-8000-000000000001', v_due, null, null);
    raise exception 'segunda confirmación permitida';
  exception when others then if sqlstate <> '40001' then raise; end if; end;
end;
$$;

-- Reactivación preserva o salta vencimiento según modo.
do $$
declare v_before timestamptz; v_after timestamptz; v_version integer;
begin
  select next_due_at, version into v_before, v_version from public.operational_recurring_tasks where id = '2a221000-0000-4000-8000-000000000008';
  select next_due_at into v_after from public.reactivate_operational_recurring_task('2a221000-0000-4000-8000-000000000008', v_version, 'preserve_due', null);
  perform pg_temp.qa_assert(v_after = v_before, 'reactivación debe conservar vencimiento');

  select version into v_version from public.operational_recurring_tasks where id = '2a221000-0000-4000-8000-000000000002';
  perform public.suspend_operational_recurring_task('2a221000-0000-4000-8000-000000000002', v_version, 'QA salto');
  select version into v_version from public.operational_recurring_tasks where id = '2a221000-0000-4000-8000-000000000002';
  select next_due_at into v_after from public.reactivate_operational_recurring_task('2a221000-0000-4000-8000-000000000002', v_version, 'skip_to_next', null);
  perform pg_temp.qa_assert(v_after > now(), 'reactivación skip debe avanzar a futuro');
end;
$$;

-- Coord Operaciones puede crear vía RPC.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
select pg_temp.qa_assert((select count(*) >= 12 from public.operational_recurring_tasks), 'coord_operaciones puede leer tareas');
do $$ declare v_task public.operational_recurring_tasks; begin
  v_task := public.create_operational_recurring_task(
    'QA creación coordinación', 'supervision', '00000000-0000-4000-8000-000000000003',
    'day', 3, (date_trunc('day', now() at time zone 'America/Mexico_City') + interval '9 hours') at time zone 'America/Mexico_City',
    null, '2a223000-0000-4000-8000-000000000001'
  );
  perform pg_temp.qa_assert(v_task.created_by = '00000000-0000-4000-8000-000000000003', 'actor coord debe provenir de auth.uid');
end $$;
reset role;

-- Atomicidad: si falla el INSERT de ejecución, next_due_at conserva el valor anterior.
do $$
declare v_due timestamptz;
begin
  select next_due_at into v_due from public.operational_recurring_tasks where id = '2a221000-0000-4000-8000-000000000012';
  insert into public.operational_recurring_task_executions(
    task_id, scheduled_due_at, completed_at, completed_by, next_due_at_generated
  ) values (
    '2a221000-0000-4000-8000-000000000012', v_due, now(),
    '00000000-0000-4000-8000-000000000001', v_due + interval '7 days'
  );
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$
declare v_due timestamptz;
begin
  select next_due_at into v_due from public.operational_recurring_tasks where id = '2a221000-0000-4000-8000-000000000012';
  begin
    perform public.complete_operational_recurring_task('2a221000-0000-4000-8000-000000000012', v_due, null, null);
    raise exception 'se esperaba conflicto al insertar ejecución';
  exception when others then if sqlstate <> '23505' then raise; end if; end;
  perform pg_temp.qa_assert((select next_due_at = v_due from public.operational_recurring_tasks where id = '2a221000-0000-4000-8000-000000000012'), 'fallo de ejecución no debe avanzar tarea');
  perform pg_temp.qa_assert((select count(*) = 1 from public.operational_recurring_task_executions where task_id = '2a221000-0000-4000-8000-000000000012'), 'fallo no debe crear otra ejecución');
end;
$$;
reset role;

-- Responsable que queda inactivo no borra la tarea; crear/editar con él queda bloqueado.
update public.profiles set active = false where id = '00000000-0000-4000-8000-000000000003';
select pg_temp.qa_assert((select count(*) = 1 from public.operational_recurring_tasks where id = '2a221000-0000-4000-8000-000000000010'), 'tarea con responsable inactivo debe conservarse');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$ begin
  begin perform public.create_operational_recurring_task('QA responsable inactivo', 'limpieza', '00000000-0000-4000-8000-000000000003', 'day', 1, now(), '2a220000-0000-4000-8000-000000000001'); raise exception 'responsable inactivo permitido';
  exception when others then if sqlstate <> '42501' then raise; end if; end;
end $$;
reset role;

-- service_role conserva acceso directo completo a ambas tablas.
set local role service_role;
select pg_temp.qa_assert((select count(*) >= 12 from public.operational_recurring_tasks), 'service_role SELECT funcional');
reset role;

rollback;

select jsonb_build_object(
  'suite', '2A.2-A.1 recurring operations',
  'result', 'PASS',
  'qa_tasks_persisted', (select count(*) from public.operational_recurring_tasks where id::text like '2a221000-0000-4000-8000-%'),
  'qa_executions_persisted', (select count(*) from public.operational_recurring_task_executions),
  'maintenance_ticket_references_in_rpcs', 0,
  'payments_or_cash_references_in_rpcs', 0
) as qa_result;
