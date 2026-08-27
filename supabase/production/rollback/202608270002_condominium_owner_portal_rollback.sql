-- Rollback conservador del portal condómino MVP.
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
drop table if exists public.condominium_unit_portal_access;
drop function if exists public.condominium_portal_access_scope_guard();

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

commit;
