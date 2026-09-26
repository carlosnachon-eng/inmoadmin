-- CANDIDATE ONLY. Do not apply to Production.
-- Public submission/document flows must stop depending on unrestricted table
-- SELECT/UPDATE before this can become a deployable migration.
-- Run in a DEV transaction with ROLLBACK for certification.

create or replace function public.blindaje_internal_permission(needs_edit boolean default false)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid() and p.active = true and r.es_externo = false
      and (p.role_id = 'admin' or exists (
        select 1 from public.permisos_modulo pm
        where pm.role_id = p.role_id and pm.modulo = 'poliza'
          and pm.puede_ver = true and pm.alcance = 'todos'
          and (not needs_edit or pm.puede_editar = true)
      ))
  );
$$;
revoke all on function public.blindaje_internal_permission(boolean) from public;
grant execute on function public.blindaje_internal_permission(boolean) to authenticated, service_role;

alter table public.solicitudes_inquilino enable row level security;
drop policy if exists select_equipo on public.solicitudes_inquilino;
drop policy if exists update_equipo_y_publico on public.solicitudes_inquilino;
create policy solicitudes_internal_read on public.solicitudes_inquilino
  for select to authenticated using (public.blindaje_internal_permission(false));
create policy solicitudes_internal_update on public.solicitudes_inquilino
  for update to authenticated using (public.blindaje_internal_permission(true))
  with check (public.blindaje_internal_permission(true));
revoke update, delete, truncate, references, trigger on public.solicitudes_inquilino from anon;
revoke delete, truncate, references, trigger on public.solicitudes_inquilino from authenticated;

-- Partner operations and the private participants policy are intentionally unchanged.
-- Partners retain their operation/participants routes, not full tenant applications.
-- No seed, backfill, data updates, document copies, or new capture fields.
