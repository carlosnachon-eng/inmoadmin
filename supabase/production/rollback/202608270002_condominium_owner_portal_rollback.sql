-- Rollback DB conservador del portal condómino MVP.
-- El rollback de aplicación es separado: redeploy del SHA anterior de main.
-- Se niega a borrar relaciones de acceso existentes.

begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$
begin
  if to_regclass('public.condominium_unit_portal_access') is not null
     and exists(select 1 from public.condominium_unit_portal_access) then
    raise exception 'ROLLBACK ABORTADO: existen relaciones de acceso al portal.';
  end if;
end $$;

drop function if exists public.condominium_owner_portal_snapshot(uuid);
drop function if exists public.condominium_owner_portal_units();

-- Restaurar exactamente las políticas previas del hardening condominal.
drop policy if exists cuotas_hardened_update on public.cuotas_condominio;
create policy cuotas_hardened_update on public.cuotas_condominio for update to authenticated using (
  public.condominium_internal_permission('condominios',true)
  or public.condominium_owner_has_unit(condominio_id,unidad_id)
) with check (
  public.condominium_internal_permission('condominios',true)
  or public.condominium_owner_has_unit(condominio_id,unidad_id)
);

drop policy if exists gastos_hardened_select on public.gastos_condominio;
create policy gastos_hardened_select on public.gastos_condominio for select to authenticated using (
  public.condominium_internal_permission('condominios',false)
  or public.condominium_owner_has_unit(condominio_id,null)
);

drop policy if exists maintenance_hardened_select on public.maintenance_tickets;
create policy maintenance_hardened_select on public.maintenance_tickets for select to authenticated using (
  public.condominium_internal_permission('mantenimiento',false)
  or (condominio_id is not null and public.condominium_owner_has_unit(condominio_id,null))
  or (condominio_id is null and public.condominium_auth_email()<>'' and (
    exists(
      select 1 from public.contracts c
      where lower(coalesce(c.tenant_email,''))=public.condominium_auth_email()
        and c.status='activo' and c.property_name=maintenance_tickets.property_name
    )
    or exists(
      select 1 from public.properties p
      where lower(coalesce(p.owner_email,''))=public.condominium_auth_email()
        and p.name=maintenance_tickets.property_name
    )
  ))
);

create or replace function public.condominium_owner_has_unit(p_condominio_id uuid,p_unidad_id uuid default null)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.condominium_owner_portal_allowed(p_condominio_id) and exists(
    select 1 from public.unidades_condominio u
    where u.condominio_id=p_condominio_id
      and u.activo=true
      and (p_unidad_id is null or u.id=p_unidad_id)
      and public.condominium_auth_email()<>''
      and public.condominium_auth_email() in (
        lower(coalesce(u.propietario_email,'')),
        lower(coalesce(u.residente_email,''))
      )
  )
$$;

revoke all on function public.condominium_owner_has_unit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.condominium_owner_has_unit(uuid,uuid) to authenticated,service_role;

drop table if exists public.condominium_unit_portal_access;
drop function if exists public.condominium_portal_access_scope_guard();
drop function if exists public.condominium_is_controlled(uuid);

commit;
