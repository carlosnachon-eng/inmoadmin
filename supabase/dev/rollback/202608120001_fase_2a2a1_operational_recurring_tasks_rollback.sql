-- DEV ONLY - rollback de Fase 2A.2-A.1.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- NUNCA ejecutar en Producción. No usa DROP CASCADE.

begin;

do $$
begin
  if exists (
    select 1 from public.operational_recurring_tasks
    where id::text not like '2a221000-0000-4000-8000-%'
  ) then
    raise exception 'Rollback abortado: existen tareas recurrentes no QA';
  end if;
  if exists (
    select 1 from public.operational_recurring_task_executions e
    join public.operational_recurring_tasks t on t.id = e.task_id
    where t.id::text not like '2a221000-0000-4000-8000-%'
  ) then
    raise exception 'Rollback abortado: existen ejecuciones no QA';
  end if;
end;
$$;

delete from public.operational_recurring_task_executions
where task_id::text like '2a221000-0000-4000-8000-%';
delete from public.operational_recurring_tasks
where id::text like '2a221000-0000-4000-8000-%';

drop function public.complete_operational_recurring_task(uuid, timestamptz, text, text);
drop function public.disable_operational_recurring_task(uuid, integer, text);
drop function public.reactivate_operational_recurring_task(uuid, integer, text, timestamptz);
drop function public.suspend_operational_recurring_task(uuid, integer, text);
drop function public.edit_operational_recurring_task(uuid, integer, text, text, uuid, text, integer, timestamptz, uuid, uuid, integer, integer, integer, text, text, text);
drop function public.create_operational_recurring_task(text, text, uuid, text, integer, timestamptz, uuid, uuid, integer, integer, integer, text, text, text, text);

drop table public.operational_recurring_task_executions;
drop table public.operational_recurring_tasks;

drop function public.operational_recurring_validate_responsible(uuid);
drop function public.operational_recurring_next_occurrence(timestamptz, text, integer, integer, integer, text, timestamptz);
drop function public.operational_recurring_assert_schedule(text, integer, integer, integer, timestamptz, text);
drop function public.operational_recurring_actor_role();

commit;
