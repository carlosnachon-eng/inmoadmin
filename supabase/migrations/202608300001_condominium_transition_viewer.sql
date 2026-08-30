-- Acceso externo individual y de sólo consulta durante la transición condominal.
-- No crea usuarios, membresías, PII ni datos de ningún condominio.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$
begin
  if to_regclass('public.roles') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.condominium_access_memberships') is null
     or to_regprocedure('public.condominium_membership_permission(uuid,text)') is null then
    raise exception 'Faltan dependencias del modelo condominal endurecido.';
  end if;
  if exists(select 1 from public.roles where id='antive_transition' and (nombre<>'Antive — Transición / Consulta' or es_externo is distinct from true)) then
    raise exception 'El identificador antive_transition ya existe con otra definición.';
  end if;
end $$;

insert into public.roles(id,nombre,descripcion,es_externo)
values('antive_transition','Antive — Transición / Consulta','Consulta externa, individual, temporal y limitada al condominio autorizado.',true)
on conflict(id) do nothing;

create or replace function public.condominium_transition_viewer_permission(p_condominio_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.profiles p
    join public.condominium_access_memberships m on m.principal_user_id=p.id
    where p.id=auth.uid() and p.active=true and p.role_id='antive_transition'
      and m.condominio_id=p_condominio_id and m.access_role='transition_viewer'
      and m.active=true and (m.expires_at is null or m.expires_at>now())
      and m.can_edit_transition=false
      and case p_permission
        when 'units' then m.can_view_units
        when 'history' then m.can_view_history
        when 'providers' then m.can_view_providers
        when 'transition' then m.can_view_transition
        else false end
  )
$$;

revoke all on function public.condominium_transition_viewer_permission(uuid,text) from public,anon,authenticated;
grant execute on function public.condominium_transition_viewer_permission(uuid,text) to authenticated,service_role;

create policy cuotas_transition_viewer_select on public.cuotas_condominio
for select to authenticated using(public.condominium_transition_viewer_permission(condominio_id,'transition'));
create policy historical_recoveries_transition_viewer_select on public.condominium_historical_recoveries
for select to authenticated using(public.condominium_transition_viewer_permission(condominio_id,'history'));
create policy maintenance_transition_viewer_select on public.maintenance_tickets
for select to authenticated using(condominio_id is not null and public.condominium_transition_viewer_permission(condominio_id,'transition'));
create policy operation_controls_transition_viewer_select on public.condominium_operation_controls
for select to authenticated using(public.condominium_transition_viewer_permission(condominio_id,'transition'));

commit;

