-- Fase 2A Gerencia de Ventas - correccion RLS por scope
-- Estado: NO EJECUTADA.
--
-- Objetivo:
-- - Evitar que una relacion de supervision otorgue acceso transversal.
-- - Separar SELECT/INSERT/UPDATE/DELETE en disponibilidad.
-- - Limitar gv_opportunities al ambito comercial/ventas.
-- - Mantener arquitectura extensible para "Mi trabajo / Supervisar".
--
-- NO deshabilita RLS.
-- NO modifica datos.
-- NO ejecutar en Produccion sin revision separada.

begin;

create or replace function public.can_supervise_profile_in_scope(
  target_profile_id uuid,
  allowed_scopes text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when target_profile_id = auth.uid() then true
    when public.current_profile_role_id() = 'admin' then true
    when public.current_profile_role_id() in ('gerente_ventas', 'coord_operaciones') then exists (
      select 1
      from public.gv_supervision_edges e
      where e.supervisor_profile_id = auth.uid()
        and e.subordinate_profile_id = target_profile_id
        and e.active = true
        and e.scope = any(allowed_scopes)
        and e.starts_on <= current_date
        and (e.ends_on is null or e.ends_on >= current_date)
    )
    else false
  end
$$;

-- Conserva compatibilidad para futuros modulos que quieran preguntar por
-- supervision general, pero las policies nuevas deben usar scope explicito.
create or replace function public.can_supervise_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_supervise_profile_in_scope(
    target_profile_id,
    array['ventas', 'operaciones', 'administracion', 'juridico', 'global']
  )
$$;

-- ---------------------------------------------------------------------------
-- Disponibilidad: separar SELECT/INSERT/UPDATE/DELETE
-- ---------------------------------------------------------------------------

drop policy if exists "gv_advisor_availability_select_scope" on public.gv_advisor_availability;
drop policy if exists "gv_advisor_availability_write_management" on public.gv_advisor_availability;
drop policy if exists "gv_advisor_availability_insert_scope" on public.gv_advisor_availability;
drop policy if exists "gv_advisor_availability_update_scope" on public.gv_advisor_availability;
drop policy if exists "gv_advisor_availability_delete_admin" on public.gv_advisor_availability;

create policy "gv_advisor_availability_select_scope"
on public.gv_advisor_availability
for select
to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or profile_id = auth.uid()
  or (
    public.current_profile_role_id() = 'gerente_ventas'
    and public.can_supervise_profile_in_scope(profile_id, array['ventas'])
  )
  or (
    public.current_profile_role_id() = 'coord_operaciones'
    and public.can_supervise_profile_in_scope(profile_id, array['operaciones'])
  )
);

create policy "gv_advisor_availability_insert_scope"
on public.gv_advisor_availability
for insert
to authenticated
with check (
  public.current_profile_role_id() = 'admin'
  or (
    public.current_profile_role_id() = 'gerente_ventas'
    and public.can_supervise_profile_in_scope(profile_id, array['ventas'])
  )
  or (
    public.current_profile_role_id() = 'coord_operaciones'
    and public.can_supervise_profile_in_scope(profile_id, array['operaciones'])
  )
);

create policy "gv_advisor_availability_update_scope"
on public.gv_advisor_availability
for update
to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or (
    public.current_profile_role_id() = 'gerente_ventas'
    and public.can_supervise_profile_in_scope(profile_id, array['ventas'])
  )
  or (
    public.current_profile_role_id() = 'coord_operaciones'
    and public.can_supervise_profile_in_scope(profile_id, array['operaciones'])
  )
)
with check (
  public.current_profile_role_id() = 'admin'
  or (
    public.current_profile_role_id() = 'gerente_ventas'
    and public.can_supervise_profile_in_scope(profile_id, array['ventas'])
  )
  or (
    public.current_profile_role_id() = 'coord_operaciones'
    and public.can_supervise_profile_in_scope(profile_id, array['operaciones'])
  )
);

create policy "gv_advisor_availability_delete_admin"
on public.gv_advisor_availability
for delete
to authenticated
using (
  public.current_profile_role_id() = 'admin'
);

-- ---------------------------------------------------------------------------
-- Oportunidades: solo scope ventas/comercial
-- ---------------------------------------------------------------------------

drop policy if exists "gv_opportunities_select_scope" on public.gv_opportunities;
drop policy if exists "gv_opportunities_insert_scope" on public.gv_opportunities;
drop policy if exists "gv_opportunities_update_scope" on public.gv_opportunities;
drop policy if exists "gv_opportunities_delete_admin" on public.gv_opportunities;

create policy "gv_opportunities_select_scope"
on public.gv_opportunities
for select
to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or asesor_id = auth.uid()
  or public.can_supervise_profile_in_scope(asesor_id, array['ventas'])
);

create policy "gv_opportunities_insert_scope"
on public.gv_opportunities
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (
    asesor_id = auth.uid()
    or public.current_profile_role_id() = 'admin'
    or public.can_supervise_profile_in_scope(asesor_id, array['ventas'])
  )
);

create policy "gv_opportunities_update_scope"
on public.gv_opportunities
for update
to authenticated
using (
  asesor_id = auth.uid()
  or public.current_profile_role_id() = 'admin'
  or public.can_supervise_profile_in_scope(asesor_id, array['ventas'])
)
with check (
  updated_by = auth.uid()
  and (
    asesor_id = auth.uid()
    or public.current_profile_role_id() = 'admin'
    or public.can_supervise_profile_in_scope(asesor_id, array['ventas'])
  )
);

create policy "gv_opportunities_delete_admin"
on public.gv_opportunities
for delete
to authenticated
using (
  public.current_profile_role_id() = 'admin'
);

-- ---------------------------------------------------------------------------
-- Eventos: heredar visibilidad/accion desde oportunidad comercial
-- ---------------------------------------------------------------------------

drop policy if exists "gv_opportunity_events_select_scope" on public.gv_opportunity_events;
drop policy if exists "gv_opportunity_events_insert_scope" on public.gv_opportunity_events;

create policy "gv_opportunity_events_select_scope"
on public.gv_opportunity_events
for select
to authenticated
using (
  exists (
    select 1
    from public.gv_opportunities o
    where o.id = opportunity_id
      and (
        public.current_profile_role_id() = 'admin'
        or o.asesor_id = auth.uid()
        or public.can_supervise_profile_in_scope(o.asesor_id, array['ventas'])
      )
  )
);

create policy "gv_opportunity_events_insert_scope"
on public.gv_opportunity_events
for insert
to authenticated
with check (
  actor_profile_id = auth.uid()
  and exists (
    select 1
    from public.gv_opportunities o
    where o.id = opportunity_id
      and (
        o.asesor_id = auth.uid()
        or public.current_profile_role_id() = 'admin'
        or public.can_supervise_profile_in_scope(o.asesor_id, array['ventas'])
      )
  )
);

commit;
