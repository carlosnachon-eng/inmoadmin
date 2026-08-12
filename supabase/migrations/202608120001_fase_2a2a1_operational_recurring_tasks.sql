begin;

create table public.operational_recurring_tasks (
  id uuid primary key default gen_random_uuid(),
  task_key text not null unique,
  title text not null,
  category text not null,
  instructions text null,
  responsible_profile_id uuid not null references public.profiles(id),
  provider_name text null,
  property_id uuid null references public.properties(id) on delete restrict,
  condominium_id uuid null references public.condominios(id) on delete restrict,
  recurrence_unit text not null,
  recurrence_interval smallint not null,
  recurrence_weekday smallint null,
  recurrence_month_day smallint null,
  due_time time not null,
  timezone text not null default 'America/Mexico_City',
  next_due_at timestamptz not null,
  lead_days smallint not null default 7,
  state text not null default 'active',
  last_completed_at timestamptz null,
  suspended_at timestamptz null,
  suspended_by uuid null references public.profiles(id),
  suspension_reason text null,
  disabled_at timestamptz null,
  disabled_by uuid null references public.profiles(id),
  disable_reason text null,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint operational_recurring_tasks_location_check
    check ((property_id is not null)::integer + (condominium_id is not null)::integer = 1),
  constraint operational_recurring_tasks_category_check
    check (category = any (array[
      'limpieza', 'jardineria', 'fumigacion', 'mantenimiento_preventivo',
      'revision_equipo', 'limpieza_agua', 'supervision', 'pago_servicio'
    ])),
  constraint operational_recurring_tasks_unit_check
    check (recurrence_unit = any (array['day', 'week', 'month'])),
  constraint operational_recurring_tasks_interval_check
    check (recurrence_interval between 1 and 120),
  constraint operational_recurring_tasks_weekday_check
    check (
      (recurrence_unit = 'week' and recurrence_weekday between 0 and 6 and recurrence_month_day is null)
      or (recurrence_unit = 'month' and recurrence_weekday is null and recurrence_month_day between 1 and 31)
      or (recurrence_unit = 'day' and recurrence_weekday is null and recurrence_month_day is null)
    ),
  constraint operational_recurring_tasks_lead_days_check
    check (lead_days between 0 and 365),
  constraint operational_recurring_tasks_state_check
    check (state = any (array['active', 'suspended', 'disabled'])),
  constraint operational_recurring_tasks_version_check check (version >= 1),
  constraint operational_recurring_tasks_title_check check (length(btrim(title)) between 3 and 180),
  constraint operational_recurring_tasks_task_key_check check (length(btrim(task_key)) between 8 and 240)
);

create index operational_recurring_tasks_state_due_idx
  on public.operational_recurring_tasks (state, next_due_at);
create index operational_recurring_tasks_responsible_due_idx
  on public.operational_recurring_tasks (responsible_profile_id, state, next_due_at);
create index operational_recurring_tasks_property_idx
  on public.operational_recurring_tasks (property_id) where property_id is not null;
create index operational_recurring_tasks_condominium_idx
  on public.operational_recurring_tasks (condominium_id) where condominium_id is not null;

create table public.operational_recurring_task_executions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.operational_recurring_tasks(id) on delete restrict,
  scheduled_due_at timestamptz not null,
  completed_at timestamptz not null,
  completed_by uuid not null references public.profiles(id),
  completion_note text null,
  evidence_storage_path text null,
  next_due_at_generated timestamptz not null,
  missed_occurrences_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint operational_recurring_execution_unique unique (task_id, scheduled_due_at),
  constraint operational_recurring_execution_missed_check check (missed_occurrences_count >= 0),
  constraint operational_recurring_execution_note_check
    check (completion_note is null or length(completion_note) <= 1000),
  constraint operational_recurring_execution_evidence_check
    check (
      evidence_storage_path is null
      or (
        evidence_storage_path not like '%://%'
        and evidence_storage_path not like '/%'
        and evidence_storage_path like 'operational-recurring-evidence/%'
      )
    )
);

create index operational_recurring_executions_task_completed_idx
  on public.operational_recurring_task_executions (task_id, completed_at desc);

create or replace function public.operational_recurring_actor_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role_id
  from public.profiles p
  where p.id = auth.uid()
    and p.active = true
    and p.role_id in ('admin', 'coord_operaciones');
$$;

create or replace function public.operational_recurring_assert_schedule(
  p_recurrence_unit text,
  p_recurrence_interval integer,
  p_recurrence_weekday integer,
  p_recurrence_month_day integer,
  p_next_due_at timestamptz,
  p_timezone text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_local timestamp;
  v_last_day integer;
begin
  if p_recurrence_unit not in ('day', 'week', 'month') then
    raise exception 'recurrence_unit inválido' using errcode = '22023';
  end if;
  if p_recurrence_interval is null or p_recurrence_interval < 1 or p_recurrence_interval > 120 then
    raise exception 'recurrence_interval inválido' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'timezone inválido' using errcode = '22023';
  end if;
  if p_next_due_at is null then
    raise exception 'next_due_at es obligatorio' using errcode = '22023';
  end if;

  v_local := p_next_due_at at time zone p_timezone;

  if p_recurrence_unit = 'day' then
    if p_recurrence_weekday is not null or p_recurrence_month_day is not null then
      raise exception 'recurrencia diaria no acepta weekday ni day-of-month' using errcode = '22023';
    end if;
  elsif p_recurrence_unit = 'week' then
    if p_recurrence_weekday is null or p_recurrence_weekday not between 0 and 6
       or p_recurrence_month_day is not null then
      raise exception 'recurrencia semanal requiere weekday 0-6' using errcode = '22023';
    end if;
    if extract(dow from v_local)::integer <> p_recurrence_weekday then
      raise exception 'next_due_at no coincide con recurrence_weekday' using errcode = '22023';
    end if;
  else
    if p_recurrence_month_day is null or p_recurrence_month_day not between 1 and 31
       or p_recurrence_weekday is not null then
      raise exception 'recurrencia mensual requiere day-of-month 1-31' using errcode = '22023';
    end if;
    v_last_day := extract(day from (date_trunc('month', v_local) + interval '1 month - 1 day'))::integer;
    if extract(day from v_local)::integer <> least(p_recurrence_month_day, v_last_day) then
      raise exception 'next_due_at no coincide con recurrence_month_day' using errcode = '22023';
    end if;
  end if;
end;
$$;

create or replace function public.operational_recurring_next_occurrence(
  p_scheduled_due_at timestamptz,
  p_recurrence_unit text,
  p_recurrence_interval integer,
  p_recurrence_weekday integer,
  p_recurrence_month_day integer,
  p_timezone text,
  p_reference_at timestamptz default null
)
returns table(next_due_at timestamptz, missed_occurrences_count integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate timestamptz := p_scheduled_due_at;
  v_local timestamp;
  v_next_local timestamp;
  v_target_month timestamp;
  v_last_day integer;
  v_missed integer := 0;
  v_iterations integer := 0;
begin
  perform public.operational_recurring_assert_schedule(
    p_recurrence_unit, p_recurrence_interval, p_recurrence_weekday,
    p_recurrence_month_day, p_scheduled_due_at, p_timezone
  );

  loop
    v_iterations := v_iterations + 1;
    if v_iterations > 10000 then
      raise exception 'recurrencia excede límite de cálculo' using errcode = '54000';
    end if;

    v_local := v_candidate at time zone p_timezone;
    if p_recurrence_unit = 'day' then
      v_next_local := v_local + make_interval(days => p_recurrence_interval);
    elsif p_recurrence_unit = 'week' then
      v_next_local := v_local + make_interval(days => p_recurrence_interval * 7);
    else
      v_target_month := date_trunc('month', v_local)
        + make_interval(months => p_recurrence_interval);
      v_last_day := extract(day from (v_target_month + interval '1 month - 1 day'))::integer;
      v_next_local := (
        v_target_month::date + (least(p_recurrence_month_day, v_last_day) - 1)
      )::timestamp + v_local::time;
    end if;

    v_candidate := v_next_local at time zone p_timezone;
    exit when p_reference_at is null or v_candidate > p_reference_at;
    v_missed := v_missed + 1;
  end loop;

  return query select v_candidate, v_missed;
end;
$$;

create or replace function public.operational_recurring_validate_responsible(p_profile_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and p.active = true
      and p.role_id in ('admin', 'coord_operaciones')
  ) then
    raise exception 'responsable inactivo o no autorizado' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_operational_recurring_task(
  p_title text,
  p_category text,
  p_responsible_profile_id uuid,
  p_recurrence_unit text,
  p_recurrence_interval integer,
  p_next_due_at timestamptz,
  p_property_id uuid default null,
  p_condominium_id uuid default null,
  p_recurrence_weekday integer default null,
  p_recurrence_month_day integer default null,
  p_lead_days integer default 7,
  p_timezone text default 'America/Mexico_City',
  p_provider_name text default null,
  p_instructions text default null,
  p_task_key text default null
)
returns public.operational_recurring_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_id uuid := gen_random_uuid();
  v_task public.operational_recurring_tasks;
begin
  v_actor_role := public.operational_recurring_actor_role();
  if v_actor is null or v_actor_role is null then
    raise exception 'actor no autorizado' using errcode = '42501';
  end if;
  if (p_property_id is not null)::integer + (p_condominium_id is not null)::integer <> 1 then
    raise exception 'debe existir exactamente una ubicación' using errcode = '23514';
  end if;
  perform public.operational_recurring_validate_responsible(p_responsible_profile_id);
  perform public.operational_recurring_assert_schedule(
    p_recurrence_unit, p_recurrence_interval, p_recurrence_weekday,
    p_recurrence_month_day, p_next_due_at, p_timezone
  );

  insert into public.operational_recurring_tasks (
    id, task_key, title, category, instructions, responsible_profile_id,
    provider_name, property_id, condominium_id, recurrence_unit,
    recurrence_interval, recurrence_weekday, recurrence_month_day, due_time,
    timezone, next_due_at, lead_days, created_by, updated_by
  ) values (
    v_id,
    coalesce(nullif(btrim(p_task_key), ''), 'operational-recurring:' || v_id::text),
    btrim(p_title), p_category, nullif(btrim(p_instructions), ''),
    p_responsible_profile_id, nullif(btrim(p_provider_name), ''),
    p_property_id, p_condominium_id, p_recurrence_unit,
    p_recurrence_interval, p_recurrence_weekday, p_recurrence_month_day,
    (p_next_due_at at time zone p_timezone)::time, p_timezone,
    p_next_due_at, p_lead_days, v_actor, v_actor
  ) returning * into v_task;

  return v_task;
end;
$$;

create or replace function public.edit_operational_recurring_task(
  p_task_id uuid,
  p_expected_version integer,
  p_title text,
  p_category text,
  p_responsible_profile_id uuid,
  p_recurrence_unit text,
  p_recurrence_interval integer,
  p_next_due_at timestamptz,
  p_property_id uuid default null,
  p_condominium_id uuid default null,
  p_recurrence_weekday integer default null,
  p_recurrence_month_day integer default null,
  p_lead_days integer default 7,
  p_timezone text default 'America/Mexico_City',
  p_provider_name text default null,
  p_instructions text default null
)
returns public.operational_recurring_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_task public.operational_recurring_tasks;
begin
  if v_actor is null or public.operational_recurring_actor_role() is null then
    raise exception 'actor no autorizado' using errcode = '42501';
  end if;
  select * into v_task from public.operational_recurring_tasks where id = p_task_id for update;
  if not found then raise exception 'tarea no encontrada' using errcode = 'P0002'; end if;
  if v_task.version <> p_expected_version then raise exception 'versión desactualizada' using errcode = '40001'; end if;
  if v_task.state = 'disabled' then raise exception 'tarea desactivada' using errcode = '55000'; end if;
  if (p_property_id is not null)::integer + (p_condominium_id is not null)::integer <> 1 then
    raise exception 'debe existir exactamente una ubicación' using errcode = '23514';
  end if;
  perform public.operational_recurring_validate_responsible(p_responsible_profile_id);
  perform public.operational_recurring_assert_schedule(
    p_recurrence_unit, p_recurrence_interval, p_recurrence_weekday,
    p_recurrence_month_day, p_next_due_at, p_timezone
  );

  update public.operational_recurring_tasks set
    title = btrim(p_title), category = p_category,
    instructions = nullif(btrim(p_instructions), ''),
    responsible_profile_id = p_responsible_profile_id,
    provider_name = nullif(btrim(p_provider_name), ''),
    property_id = p_property_id, condominium_id = p_condominium_id,
    recurrence_unit = p_recurrence_unit, recurrence_interval = p_recurrence_interval,
    recurrence_weekday = p_recurrence_weekday, recurrence_month_day = p_recurrence_month_day,
    due_time = (p_next_due_at at time zone p_timezone)::time,
    timezone = p_timezone, next_due_at = p_next_due_at, lead_days = p_lead_days,
    updated_by = v_actor, updated_at = now(), version = version + 1
  where id = p_task_id returning * into v_task;
  return v_task;
end;
$$;

create or replace function public.suspend_operational_recurring_task(
  p_task_id uuid,
  p_expected_version integer,
  p_reason text
)
returns public.operational_recurring_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_task public.operational_recurring_tasks;
begin
  if v_actor is null or public.operational_recurring_actor_role() is null then
    raise exception 'actor no autorizado' using errcode = '42501';
  end if;
  select * into v_task from public.operational_recurring_tasks where id = p_task_id for update;
  if not found then raise exception 'tarea no encontrada' using errcode = 'P0002'; end if;
  if v_task.version <> p_expected_version then raise exception 'versión desactualizada' using errcode = '40001'; end if;
  if v_task.state <> 'active' then raise exception 'solo una tarea activa puede suspenderse' using errcode = '55000'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'motivo requerido' using errcode = '22023'; end if;

  update public.operational_recurring_tasks set
    state = 'suspended', suspended_at = now(), suspended_by = v_actor,
    suspension_reason = btrim(p_reason), updated_by = v_actor,
    updated_at = now(), version = version + 1
  where id = p_task_id returning * into v_task;
  return v_task;
end;
$$;

create or replace function public.reactivate_operational_recurring_task(
  p_task_id uuid,
  p_expected_version integer,
  p_mode text,
  p_new_next_due_at timestamptz default null
)
returns public.operational_recurring_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_task public.operational_recurring_tasks;
  v_next timestamptz;
begin
  v_role := public.operational_recurring_actor_role();
  if v_actor is null or v_role is null then raise exception 'actor no autorizado' using errcode = '42501'; end if;
  select * into v_task from public.operational_recurring_tasks where id = p_task_id for update;
  if not found then raise exception 'tarea no encontrada' using errcode = 'P0002'; end if;
  if v_task.version <> p_expected_version then raise exception 'versión desactualizada' using errcode = '40001'; end if;
  if v_task.state not in ('suspended', 'disabled') then raise exception 'tarea no suspendida/desactivada' using errcode = '55000'; end if;

  if v_task.state = 'disabled' then
    if v_role <> 'admin' then raise exception 'solo admin puede reactivar una tarea desactivada' using errcode = '42501'; end if;
    if p_mode <> 'new_due' or p_new_next_due_at is null then
      raise exception 'reactivar desactivada requiere new_due' using errcode = '22023';
    end if;
    v_next := p_new_next_due_at;
  elsif p_mode = 'preserve_due' then
    v_next := v_task.next_due_at;
  elsif p_mode = 'skip_to_next' then
    if v_task.next_due_at > now() then
      v_next := v_task.next_due_at;
    else
      select n.next_due_at into v_next
      from public.operational_recurring_next_occurrence(
        v_task.next_due_at, v_task.recurrence_unit, v_task.recurrence_interval,
        v_task.recurrence_weekday, v_task.recurrence_month_day,
        v_task.timezone, now()
      ) n;
    end if;
  elsif p_mode = 'new_due' and p_new_next_due_at is not null then
    v_next := p_new_next_due_at;
  else
    raise exception 'modo de reactivación inválido' using errcode = '22023';
  end if;

  perform public.operational_recurring_validate_responsible(v_task.responsible_profile_id);
  perform public.operational_recurring_assert_schedule(
    v_task.recurrence_unit, v_task.recurrence_interval, v_task.recurrence_weekday,
    v_task.recurrence_month_day, v_next, v_task.timezone
  );

  update public.operational_recurring_tasks set
    state = 'active', next_due_at = v_next,
    due_time = (v_next at time zone v_task.timezone)::time,
    suspended_at = null, suspended_by = null, suspension_reason = null,
    disabled_at = null, disabled_by = null, disable_reason = null,
    updated_by = v_actor, updated_at = now(), version = version + 1
  where id = p_task_id returning * into v_task;
  return v_task;
end;
$$;

create or replace function public.disable_operational_recurring_task(
  p_task_id uuid,
  p_expected_version integer,
  p_reason text
)
returns public.operational_recurring_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_task public.operational_recurring_tasks;
begin
  if v_actor is null or public.operational_recurring_actor_role() is null then
    raise exception 'actor no autorizado' using errcode = '42501';
  end if;
  select * into v_task from public.operational_recurring_tasks where id = p_task_id for update;
  if not found then raise exception 'tarea no encontrada' using errcode = 'P0002'; end if;
  if v_task.version <> p_expected_version then raise exception 'versión desactualizada' using errcode = '40001'; end if;
  if v_task.state = 'disabled' then raise exception 'tarea ya desactivada' using errcode = '55000'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'motivo requerido' using errcode = '22023'; end if;

  update public.operational_recurring_tasks set
    state = 'disabled', disabled_at = now(), disabled_by = v_actor,
    disable_reason = btrim(p_reason), updated_by = v_actor,
    updated_at = now(), version = version + 1
  where id = p_task_id returning * into v_task;
  return v_task;
end;
$$;

create or replace function public.complete_operational_recurring_task(
  p_task_id uuid,
  p_expected_due_at timestamptz,
  p_completion_note text default null,
  p_evidence_storage_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_completed_at timestamptz := clock_timestamp();
  v_task public.operational_recurring_tasks;
  v_execution public.operational_recurring_task_executions;
  v_next timestamptz;
  v_missed integer;
begin
  if v_actor is null or public.operational_recurring_actor_role() is null then
    raise exception 'actor no autorizado' using errcode = '42501';
  end if;
  select * into v_task from public.operational_recurring_tasks where id = p_task_id for update;
  if not found then raise exception 'tarea no encontrada' using errcode = 'P0002'; end if;
  if v_task.state <> 'active' then raise exception 'tarea no activa' using errcode = '55000'; end if;
  if v_task.next_due_at is distinct from p_expected_due_at then
    raise exception 'expected_due_at desactualizado' using errcode = '40001';
  end if;

  select n.next_due_at, n.missed_occurrences_count into v_next, v_missed
  from public.operational_recurring_next_occurrence(
    v_task.next_due_at, v_task.recurrence_unit, v_task.recurrence_interval,
    v_task.recurrence_weekday, v_task.recurrence_month_day,
    v_task.timezone, v_completed_at
  ) n;

  insert into public.operational_recurring_task_executions (
    task_id, scheduled_due_at, completed_at, completed_by, completion_note,
    evidence_storage_path, next_due_at_generated, missed_occurrences_count
  ) values (
    v_task.id, v_task.next_due_at, v_completed_at, v_actor,
    nullif(btrim(p_completion_note), ''), nullif(btrim(p_evidence_storage_path), ''),
    v_next, v_missed
  ) returning * into v_execution;

  update public.operational_recurring_tasks set
    next_due_at = v_next,
    due_time = (v_next at time zone v_task.timezone)::time,
    last_completed_at = v_completed_at,
    updated_by = v_actor,
    updated_at = v_completed_at,
    version = version + 1
  where id = v_task.id returning * into v_task;

  return jsonb_build_object('task', to_jsonb(v_task), 'execution', to_jsonb(v_execution));
end;
$$;

alter table public.operational_recurring_tasks enable row level security;
alter table public.operational_recurring_task_executions enable row level security;

revoke all on table public.operational_recurring_tasks from public, anon, authenticated;
revoke all on table public.operational_recurring_task_executions from public, anon, authenticated;
grant select on table public.operational_recurring_tasks to authenticated;
grant select on table public.operational_recurring_task_executions to authenticated;
grant all privileges on table public.operational_recurring_tasks to service_role;
grant all privileges on table public.operational_recurring_task_executions to service_role;

create policy operational_recurring_tasks_select_operations
on public.operational_recurring_tasks for select to authenticated
using (public.operational_recurring_actor_role() is not null);

create policy operational_recurring_executions_select_operations
on public.operational_recurring_task_executions for select to authenticated
using (public.operational_recurring_actor_role() is not null);

revoke all on function public.operational_recurring_actor_role() from public, anon, authenticated;
revoke all on function public.operational_recurring_assert_schedule(text, integer, integer, integer, timestamptz, text) from public, anon, authenticated;
revoke all on function public.operational_recurring_next_occurrence(timestamptz, text, integer, integer, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.operational_recurring_validate_responsible(uuid) from public, anon, authenticated;

grant execute on function public.operational_recurring_actor_role() to authenticated, service_role;
grant execute on function public.operational_recurring_assert_schedule(text, integer, integer, integer, timestamptz, text) to service_role;
grant execute on function public.operational_recurring_next_occurrence(timestamptz, text, integer, integer, integer, text, timestamptz) to service_role;
grant execute on function public.operational_recurring_validate_responsible(uuid) to service_role;

revoke all on function public.create_operational_recurring_task(text, text, uuid, text, integer, timestamptz, uuid, uuid, integer, integer, integer, text, text, text, text) from public, anon;
revoke all on function public.edit_operational_recurring_task(uuid, integer, text, text, uuid, text, integer, timestamptz, uuid, uuid, integer, integer, integer, text, text, text) from public, anon;
revoke all on function public.suspend_operational_recurring_task(uuid, integer, text) from public, anon;
revoke all on function public.reactivate_operational_recurring_task(uuid, integer, text, timestamptz) from public, anon;
revoke all on function public.disable_operational_recurring_task(uuid, integer, text) from public, anon;
revoke all on function public.complete_operational_recurring_task(uuid, timestamptz, text, text) from public, anon;

grant execute on function public.create_operational_recurring_task(text, text, uuid, text, integer, timestamptz, uuid, uuid, integer, integer, integer, text, text, text, text) to authenticated, service_role;
grant execute on function public.edit_operational_recurring_task(uuid, integer, text, text, uuid, text, integer, timestamptz, uuid, uuid, integer, integer, integer, text, text, text) to authenticated, service_role;
grant execute on function public.suspend_operational_recurring_task(uuid, integer, text) to authenticated, service_role;
grant execute on function public.reactivate_operational_recurring_task(uuid, integer, text, timestamptz) to authenticated, service_role;
grant execute on function public.disable_operational_recurring_task(uuid, integer, text) to authenticated, service_role;
grant execute on function public.complete_operational_recurring_task(uuid, timestamptz, text, text) to authenticated, service_role;

commit;
