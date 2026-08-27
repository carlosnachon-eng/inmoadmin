-- Fase 3A: hardening RLS condominal y acceso transitorio por tenant.
-- No contiene datos, usuarios, cuotas, pagos ni comunicaciones.

begin;

set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.condominium_access_memberships (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  principal_user_id uuid not null,
  access_role text not null check (access_role in ('transition_viewer','transition_editor','internal_delegate')),
  can_view_units boolean not null default false,
  can_view_history boolean not null default false,
  can_view_providers boolean not null default false,
  can_view_transition boolean not null default false,
  can_edit_transition boolean not null default false,
  active boolean not null default true,
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(id) on delete restrict,
  notes text null check (notes is null or length(notes)<=1000),
  unique(condominio_id,principal_user_id)
);

create index condominium_access_memberships_principal_idx
on public.condominium_access_memberships(principal_user_id,condominio_id)
where active;

alter table public.condominium_access_memberships enable row level security;
revoke all on public.condominium_access_memberships from public,anon,authenticated;
grant select on public.condominium_access_memberships to authenticated;
grant all privileges on public.condominium_access_memberships to service_role;

create or replace function public.condominium_auth_email()
returns text language sql stable security definer set search_path=public,pg_temp
as $$ select lower(coalesce(auth.jwt()->>'email','')) $$;

create or replace function public.condominium_internal_permission(p_module text,p_edit boolean default false)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$
  select exists(
    select 1 from public.profiles p
    left join public.roles r on r.id=p.role_id
    where p.id=auth.uid() and p.active=true and coalesce(r.es_externo,false)=false
      and (
        p.role_id='admin'
        or exists(
          select 1 from public.permisos_modulo pm
          where pm.role_id=p.role_id and pm.modulo=p_module
            and pm.puede_ver=true and (not p_edit or pm.puede_editar=true)
        )
      )
  )
$$;

create or replace function public.condominium_membership_permission(p_condominio_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$
  select exists(
    select 1 from public.condominium_access_memberships m
    where m.condominio_id=p_condominio_id and m.principal_user_id=auth.uid()
      and m.active=true and (m.expires_at is null or m.expires_at>now())
      and case p_permission
        when 'units' then m.can_view_units
        when 'history' then m.can_view_history
        when 'providers' then m.can_view_providers
        when 'transition' then m.can_view_transition
        when 'edit_transition' then m.can_edit_transition
        else false end
  )
$$;

create or replace function public.condominium_owner_has_unit(p_condominio_id uuid,p_unidad_id uuid default null)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$
  select public.condominium_owner_portal_allowed(p_condominio_id) and exists(
    select 1 from public.unidades_condominio u
    where u.condominio_id=p_condominio_id and u.activo=true
      and (p_unidad_id is null or u.id=p_unidad_id)
      and public.condominium_auth_email()<>''
      and public.condominium_auth_email() in (lower(coalesce(u.propietario_email,'')),lower(coalesce(u.residente_email,'')))
  )
$$;

revoke all on function public.condominium_auth_email() from public,anon,authenticated;
revoke all on function public.condominium_internal_permission(text,boolean) from public,anon,authenticated;
revoke all on function public.condominium_membership_permission(uuid,text) from public,anon,authenticated;
revoke all on function public.condominium_owner_has_unit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.condominium_auth_email() to authenticated,service_role;
grant execute on function public.condominium_internal_permission(text,boolean) to authenticated,service_role;
grant execute on function public.condominium_membership_permission(uuid,text) to authenticated,service_role;
grant execute on function public.condominium_owner_has_unit(uuid,uuid) to authenticated,service_role;

create policy condominium_access_memberships_self_select on public.condominium_access_memberships
for select to authenticated using (
  principal_user_id=auth.uid() or public.condominium_internal_permission('condominios',false)
);

-- Base condominal: eliminar exposición anónima, conservar flujos internos y portal propio.

alter table public.condominios enable row level security;
alter table public.unidades_condominio enable row level security;
alter table public.cuotas_condominio enable row level security;
alter table public.gastos_condominio enable row level security;

do $$
declare p record;
begin
  for p in select schemaname,tablename,policyname from pg_policies
    where schemaname='public' and tablename in ('condominios','unidades_condominio','cuotas_condominio','gastos_condominio')
  loop
    execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename);
  end loop;
end $$;

revoke all on public.condominios,public.unidades_condominio,public.cuotas_condominio,public.gastos_condominio from public,anon,authenticated;
grant select,insert,update,delete on public.condominios,public.unidades_condominio,public.cuotas_condominio,public.gastos_condominio to authenticated;
grant all privileges on public.condominios,public.unidades_condominio,public.cuotas_condominio,public.gastos_condominio to service_role;

drop policy if exists condominios_hardened_select on public.condominios;
drop policy if exists condominios_hardened_insert on public.condominios;
drop policy if exists condominios_hardened_update on public.condominios;
drop policy if exists condominios_hardened_delete on public.condominios;
create policy condominios_hardened_select on public.condominios for select to authenticated using (
  public.condominium_internal_permission('condominios',false)
  or public.condominium_membership_permission(id,'transition')
  or public.condominium_membership_permission(id,'history')
  or public.condominium_owner_has_unit(id,null)
);
create policy condominios_hardened_insert on public.condominios for insert to authenticated with check (public.condominium_internal_permission('condominios',true));
create policy condominios_hardened_update on public.condominios for update to authenticated using (public.condominium_internal_permission('condominios',true)) with check (public.condominium_internal_permission('condominios',true));
create policy condominios_hardened_delete on public.condominios for delete to authenticated using (public.condominium_internal_permission('condominios',true));

drop policy if exists unidades_hardened_select on public.unidades_condominio;
drop policy if exists unidades_hardened_insert on public.unidades_condominio;
drop policy if exists unidades_hardened_update on public.unidades_condominio;
drop policy if exists unidades_hardened_delete on public.unidades_condominio;
create policy unidades_hardened_select on public.unidades_condominio for select to authenticated using (
  public.condominium_internal_permission('condominios',false)
  or public.condominium_membership_permission(condominio_id,'units')
  or public.condominium_owner_has_unit(condominio_id,id)
);
create policy unidades_hardened_insert on public.unidades_condominio for insert to authenticated with check (public.condominium_internal_permission('condominios',true));
create policy unidades_hardened_update on public.unidades_condominio for update to authenticated using (public.condominium_internal_permission('condominios',true)) with check (public.condominium_internal_permission('condominios',true));
create policy unidades_hardened_delete on public.unidades_condominio for delete to authenticated using (public.condominium_internal_permission('condominios',true));

drop policy if exists cuotas_hardened_select on public.cuotas_condominio;
drop policy if exists cuotas_hardened_insert on public.cuotas_condominio;
drop policy if exists cuotas_hardened_update on public.cuotas_condominio;
drop policy if exists cuotas_hardened_delete on public.cuotas_condominio;
create policy cuotas_hardened_select on public.cuotas_condominio for select to authenticated using (
  public.condominium_internal_permission('condominios',false)
  or public.condominium_owner_has_unit(condominio_id,unidad_id)
);
create policy cuotas_hardened_insert on public.cuotas_condominio for insert to authenticated with check (public.condominium_internal_permission('condominios',true));
create policy cuotas_hardened_update on public.cuotas_condominio for update to authenticated using (
  public.condominium_internal_permission('condominios',true) or public.condominium_owner_has_unit(condominio_id,unidad_id)
) with check (
  public.condominium_internal_permission('condominios',true) or public.condominium_owner_has_unit(condominio_id,unidad_id)
);
create policy cuotas_hardened_delete on public.cuotas_condominio for delete to authenticated using (public.condominium_internal_permission('condominios',true));

drop policy if exists gastos_condominio_internal_qa on public.gastos_condominio;
drop policy if exists gastos_hardened_select on public.gastos_condominio;
drop policy if exists gastos_hardened_insert on public.gastos_condominio;
drop policy if exists gastos_hardened_update on public.gastos_condominio;
drop policy if exists gastos_hardened_delete on public.gastos_condominio;
create policy gastos_hardened_select on public.gastos_condominio for select to authenticated using (
  public.condominium_internal_permission('condominios',false) or public.condominium_owner_has_unit(condominio_id,null)
);
create policy gastos_hardened_insert on public.gastos_condominio for insert to authenticated with check (public.condominium_internal_permission('condominios',true));
create policy gastos_hardened_update on public.gastos_condominio for update to authenticated using (public.condominium_internal_permission('condominios',true)) with check (public.condominium_internal_permission('condominios',true));
create policy gastos_hardened_delete on public.gastos_condominio for delete to authenticated using (public.condominium_internal_permission('condominios',true));

create or replace function public.condominium_external_fee_update_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- SQL administrativo y service_role no tienen un auth.uid() de usuario.
  -- Sus privilegios siguen controlados por grants; el guard sólo restringe el portal.
  if auth.uid() is null then return new; end if;
  if public.condominium_internal_permission('condominios',true) then return new; end if;
  if not public.condominium_owner_has_unit(old.condominio_id,old.unidad_id) then
    raise exception using errcode='42501',message='No autorizado para modificar esta cuota.';
  end if;
  if new.id is distinct from old.id or new.condominio_id is distinct from old.condominio_id
     or new.unidad_id is distinct from old.unidad_id or new.periodo is distinct from old.periodo
     or new.monto is distinct from old.monto or new.fecha_vencimiento is distinct from old.fecha_vencimiento
     or new.fecha_pago is distinct from old.fecha_pago or new.pagado_por is distinct from old.pagado_por
     or new.forma_pago is distinct from old.forma_pago or new.notas is distinct from old.notas
     or new.recibo_url is distinct from old.recibo_url or new.status<>'pendiente'
  then raise exception using errcode='42501',message='El portal sólo puede adjuntar un comprobante pendiente.';
  end if;
  return new;
end $$;
drop trigger if exists condominium_external_fee_update_guard on public.cuotas_condominio;
create trigger condominium_external_fee_update_guard before update on public.cuotas_condominio
for each row execute function public.condominium_external_fee_update_guard();
revoke all on function public.condominium_external_fee_update_guard() from public,anon,authenticated;

-- Mantenimiento: reemplazar política ALL true por reglas mínimas.
alter table public.maintenance_tickets enable row level security;
revoke all on public.maintenance_tickets from public,anon,authenticated;
grant select,insert,update,delete on public.maintenance_tickets to authenticated;
grant all privileges on public.maintenance_tickets to service_role;
do $$
declare p record;
begin
  for p in select schemaname,tablename,policyname from pg_policies
    where schemaname='public' and tablename='maintenance_tickets'
  loop
    execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename);
  end loop;
end $$;
drop policy if exists maintenance_hardened_select on public.maintenance_tickets;
drop policy if exists maintenance_hardened_insert on public.maintenance_tickets;
drop policy if exists maintenance_hardened_update on public.maintenance_tickets;
drop policy if exists maintenance_hardened_delete on public.maintenance_tickets;
create policy maintenance_hardened_select on public.maintenance_tickets for select to authenticated using (
  public.condominium_internal_permission('mantenimiento',false)
  or (condominio_id is not null and public.condominium_owner_has_unit(condominio_id,null))
  or (condominio_id is null and public.condominium_auth_email()<>'' and (
    exists(select 1 from public.contracts c where lower(coalesce(c.tenant_email,''))=public.condominium_auth_email() and c.status='activo' and c.property_name=maintenance_tickets.property_name)
    or exists(select 1 from public.properties p where lower(coalesce(p.owner_email,''))=public.condominium_auth_email() and p.name=maintenance_tickets.property_name)
  ))
);
create policy maintenance_hardened_insert on public.maintenance_tickets for insert to authenticated with check (
  public.condominium_internal_permission('mantenimiento',true)
  or (condominio_id is null and status='nuevo' and public.condominium_auth_email()<>'' and
    exists(select 1 from public.contracts c where lower(coalesce(c.tenant_email,''))=public.condominium_auth_email() and c.status='activo' and c.property_name=maintenance_tickets.property_name and c.tenant_name=maintenance_tickets.tenant_name))
);
create policy maintenance_hardened_update on public.maintenance_tickets for update to authenticated using (public.condominium_internal_permission('mantenimiento',true)) with check (public.condominium_internal_permission('mantenimiento',true));
create policy maintenance_hardened_delete on public.maintenance_tickets for delete to authenticated using (public.condominium_internal_permission('mantenimiento',true));

-- Reemplazar lecturas internas de las tablas nuevas por internas + Antive limitado.
drop policy if exists condominium_sections_internal_select on public.condominium_sections;
create policy condominium_sections_internal_select on public.condominium_sections for select to authenticated using (
  public.condominium_internal_permission('condominios',false) or public.condominium_membership_permission(condominio_id,'transition')
);
drop policy if exists condominium_unit_section_memberships_internal_select on public.condominium_unit_section_memberships;
create policy condominium_unit_section_memberships_internal_select on public.condominium_unit_section_memberships for select to authenticated using (
  public.condominium_internal_permission('condominios',false) or public.condominium_membership_permission(condominio_id,'units')
);
drop policy if exists condominium_historical_accounts_internal_select on public.condominium_historical_accounts;
create policy condominium_historical_accounts_internal_select on public.condominium_historical_accounts for select to authenticated using (
  public.condominium_internal_permission('condominios',false) or public.condominium_membership_permission(condominio_id,'history')
);
drop policy if exists condominium_historical_payments_internal_select on public.condominium_historical_payments;
create policy condominium_historical_payments_internal_select on public.condominium_historical_payments for select to authenticated using (
  public.condominium_internal_permission('condominios',false) or public.condominium_membership_permission(condominio_id,'history')
);
drop policy if exists condominium_historical_recoveries_internal_select on public.condominium_historical_recoveries;
create policy condominium_historical_recoveries_internal_select on public.condominium_historical_recoveries for select to authenticated using (public.condominium_internal_permission('condominios',false));
drop policy if exists condominium_provider_preparations_internal_select on public.condominium_provider_preparations;
create policy condominium_provider_preparations_internal_select on public.condominium_provider_preparations for select to authenticated using (
  public.condominium_internal_permission('condominios',false) or public.condominium_membership_permission(condominio_id,'providers')
);
drop policy if exists condominium_transition_items_internal_select on public.condominium_transition_items;
create policy condominium_transition_items_internal_select on public.condominium_transition_items for select to authenticated using (
  public.condominium_internal_permission('condominios',false) or public.condominium_membership_permission(condominio_id,'transition')
);
grant update(description,operational_status,evidence_reference,updated_at) on public.condominium_transition_items to authenticated;
create policy condominium_transition_items_transition_update on public.condominium_transition_items for update to authenticated
using (
  public.condominium_internal_permission('condominios',true)
  or public.condominium_membership_permission(condominio_id,'edit_transition')
)
with check (
  public.condominium_internal_permission('condominios',true)
  or public.condominium_membership_permission(condominio_id,'edit_transition')
);

commit;
