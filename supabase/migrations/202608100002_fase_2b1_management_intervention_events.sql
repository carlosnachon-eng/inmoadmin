begin;

create table if not exists public.gv_management_intervention_events (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.gv_management_interventions(id) on delete cascade,
  event_type text not null
    check (event_type in ('created', 'status_changed', 'review_logged', 'note_added')),
  actor_profile_id uuid not null references public.profiles(id),
  old_status text null
    check (old_status is null or old_status in ('pendiente', 'en_seguimiento', 'corregida', 'sin_mejora', 'cerrada_decision_tomada')),
  new_status text null
    check (new_status is null or new_status in ('pendiente', 'en_seguimiento', 'corregida', 'sin_mejora', 'cerrada_decision_tomada')),
  review_on date null,
  notes text null,
  indicators_snapshot jsonb not null default '{}'::jsonb,
  comparison jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_gv_management_intervention_events_intervention
  on public.gv_management_intervention_events (intervention_id, created_at desc);

create index if not exists idx_gv_management_intervention_events_actor
  on public.gv_management_intervention_events (actor_profile_id, created_at desc);

create index if not exists idx_gv_management_intervention_events_status
  on public.gv_management_intervention_events (new_status, created_at desc);

alter table public.gv_management_intervention_events enable row level security;

revoke all on public.gv_management_intervention_events from public, anon, authenticated;
grant select on public.gv_management_intervention_events to authenticated;
grant all on public.gv_management_intervention_events to service_role;

revoke insert, update, delete on public.gv_management_interventions from authenticated;

drop policy if exists "gv_management_interventions_select_scope" on public.gv_management_interventions;
create policy "gv_management_interventions_select_scope" on public.gv_management_interventions
for select to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or (
    public.current_profile_role_id() = 'gerente_ventas'
    and public.can_supervise_profile_in_scope(advisor_profile_id, array['ventas', 'global'])
  )
);

drop policy if exists "gv_management_intervention_events_select_scope" on public.gv_management_intervention_events;
create policy "gv_management_intervention_events_select_scope" on public.gv_management_intervention_events
for select to authenticated
using (
  exists (
    select 1
    from public.gv_management_interventions i
    where i.id = intervention_id
      and (
        public.current_profile_role_id() = 'admin'
        or (
          public.current_profile_role_id() = 'gerente_ventas'
          and (
            public.can_supervise_profile_in_scope(i.advisor_profile_id, array['ventas', 'global'])
          )
        )
      )
  )
);

drop policy if exists "gv_management_intervention_events_insert_scope" on public.gv_management_intervention_events;
drop policy if exists "gv_management_intervention_events_update_scope" on public.gv_management_intervention_events;
drop policy if exists "gv_management_intervention_events_delete_scope" on public.gv_management_intervention_events;

create or replace function public.create_management_intervention(
  p_advisor_profile_id uuid,
  p_reason text,
  p_agreed_action text,
  p_review_on date default null,
  p_notes text default null,
  p_indicators jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_intervention public.gv_management_interventions%rowtype;
  v_event public.gv_management_intervention_events%rowtype;
begin
  if v_actor_id is null then
    raise exception using errcode = '28000', message = 'Sesion requerida.';
  end if;

  select p.role_id
    into v_actor_role
  from public.profiles p
  where p.id = v_actor_id
    and p.active = true;

  if v_actor_role not in ('admin', 'gerente_ventas') then
    raise exception using errcode = '42501', message = 'Intervencion no autorizada.';
  end if;
  if p_advisor_profile_id is null
     or (v_actor_role = 'gerente_ventas'
         and not public.can_supervise_profile_in_scope(p_advisor_profile_id, array['ventas', 'global'])) then
    raise exception using errcode = '42501', message = 'Asesor fuera del scope autorizado.';
  end if;
  if nullif(trim(p_reason), '') is null or nullif(trim(p_agreed_action), '') is null then
    raise exception using errcode = '22023', message = 'Faltan datos minimos.';
  end if;
  if p_indicators is null or jsonb_typeof(p_indicators) <> 'object' then
    raise exception using errcode = '22023', message = 'Indicadores invalidos.';
  end if;

  insert into public.gv_management_interventions (
    advisor_profile_id, actor_profile_id, scope, reason, agreed_action,
    review_on, status, indicators, notes
  ) values (
    p_advisor_profile_id, v_actor_id, 'ventas', left(trim(p_reason), 220),
    left(trim(p_agreed_action), 220), p_review_on, 'pendiente', p_indicators,
    nullif(left(trim(coalesce(p_notes, '')), 500), '')
  )
  returning * into v_intervention;

  insert into public.gv_management_intervention_events (
    intervention_id, event_type, actor_profile_id, old_status, new_status,
    review_on, notes, indicators_snapshot, comparison
  ) values (
    v_intervention.id, 'created', v_actor_id, null, 'pendiente',
    p_review_on, nullif(left(trim(coalesce(p_notes, '')), 500), ''),
    p_indicators, '{}'::jsonb
  )
  returning * into v_event;

  return jsonb_build_object(
    'intervention', to_jsonb(v_intervention),
    'event', to_jsonb(v_event)
  );
end;
$$;

create or replace function public.review_management_intervention(
  p_intervention_id uuid,
  p_status text,
  p_review_on date default null,
  p_notes text default null,
  p_indicators_snapshot jsonb default '{}'::jsonb,
  p_comparison jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_old public.gv_management_interventions%rowtype;
  v_intervention public.gv_management_interventions%rowtype;
  v_event public.gv_management_intervention_events%rowtype;
  v_event_type text;
begin
  if v_actor_id is null then
    raise exception using errcode = '28000', message = 'Sesion requerida.';
  end if;

  select p.role_id
    into v_actor_role
  from public.profiles p
  where p.id = v_actor_id
    and p.active = true;

  if v_actor_role not in ('admin', 'gerente_ventas') then
    raise exception using errcode = '42501', message = 'Intervencion no autorizada.';
  end if;
  if p_status not in ('pendiente', 'en_seguimiento', 'corregida', 'sin_mejora', 'cerrada_decision_tomada') then
    raise exception using errcode = '22023', message = 'Estatus no valido.';
  end if;
  if p_indicators_snapshot is null or jsonb_typeof(p_indicators_snapshot) <> 'object'
     or p_comparison is null or jsonb_typeof(p_comparison) <> 'object' then
    raise exception using errcode = '22023', message = 'Snapshot o comparacion invalidos.';
  end if;

  select i.*
    into v_old
  from public.gv_management_interventions i
  where i.id = p_intervention_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Intervencion fuera del scope autorizado.';
  end if;
  if v_old.scope <> 'ventas'
     or (v_actor_role = 'gerente_ventas'
         and not public.can_supervise_profile_in_scope(v_old.advisor_profile_id, array['ventas', 'global'])) then
    raise exception using errcode = '42501', message = 'Intervencion fuera del scope autorizado.';
  end if;

  v_event_type := case when v_old.status = p_status then 'review_logged' else 'status_changed' end;

  update public.gv_management_interventions i
  set status = p_status,
      review_on = p_review_on,
      notes = coalesce(nullif(left(trim(coalesce(p_notes, '')), 500), ''), i.notes),
      updated_at = now()
  where i.id = p_intervention_id
  returning * into v_intervention;

  insert into public.gv_management_intervention_events (
    intervention_id, event_type, actor_profile_id, old_status, new_status,
    review_on, notes, indicators_snapshot, comparison
  ) values (
    v_intervention.id, v_event_type, v_actor_id, v_old.status, v_intervention.status,
    v_intervention.review_on, nullif(left(trim(coalesce(p_notes, '')), 500), ''),
    p_indicators_snapshot, p_comparison
  )
  returning * into v_event;

  return jsonb_build_object(
    'intervention', to_jsonb(v_intervention),
    'event', to_jsonb(v_event)
  );
end;
$$;

revoke all on function public.create_management_intervention(uuid, text, text, date, text, jsonb) from public, anon;
revoke all on function public.review_management_intervention(uuid, text, date, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_management_intervention(uuid, text, text, date, text, jsonb) to authenticated, service_role;
grant execute on function public.review_management_intervention(uuid, text, date, text, jsonb, jsonb) to authenticated, service_role;

comment on table public.gv_management_intervention_events is
  'Historial inmutable de creacion, revision y cambios de estado de intervenciones gerenciales Fase 2B-1.';

commit;
