-- Incidencias V1: prioridad y responsable administrativo.
-- Frontera temporal de asignación: directorio interno activo. La futura raíz será
-- organization/administrator -> condominium -> internal users.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $$ begin
  if to_regprocedure('public.condominium_update_incident_v1(uuid,uuid,text,text,uuid,text,text,text)') is null
     or to_regclass('public.partner_users') is null then
    raise exception 'INCIDENT_ADMIN_CONTROLS_UNEXPECTED_BASELINE';
  end if;
end $$;

create or replace function public.condominium_admin_update_incident_v1(
  p_ticket_id uuid,p_condominio_id uuid,p_status text default null,p_priority text default null,
  p_responsible_profile_id uuid default null,p_responsible_change boolean default false,
  p_message text default null,p_visibility text default 'internal',p_resolution_summary text default null
) returns public.maintenance_tickets language plpgsql security definer set search_path=public,pg_temp as $$
declare
  t public.maintenance_tickets; old_status text; old_priority text; old_responsible uuid; allowed boolean;
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios',true) then raise exception 'OPERATION_NOT_ALLOWED'; end if;
  if p_priority is not null and p_priority not in ('baja','media','alta','urgente') then raise exception 'INVALID_PRIORITY'; end if;
  if p_visibility not in ('resident','internal') then raise exception 'INVALID_VISIBILITY'; end if;
  if p_responsible_change and p_responsible_profile_id is not null and not exists(
    select 1 from public.profiles p join public.roles r on r.id=p.role_id
    where p.id=p_responsible_profile_id and p.active=true and r.es_externo=false
      and not exists(select 1 from public.partner_users pu where pu.auth_user_id=p.id and pu.active=true)
  ) then raise exception 'INVALID_RESPONSIBLE'; end if;

  select * into t from public.maintenance_tickets where id=p_ticket_id and condominio_id=p_condominio_id and not legacy_record for update;
  if not found then raise exception 'TICKET_NOT_FOUND'; end if;
  old_status:=t.status; old_priority:=t.priority; old_responsible:=t.responsible_profile_id;
  allowed:=p_status is null or p_status=old_status or (old_status,p_status) in (('nuevo','revisado'),('revisado','en_proceso'),('revisado','cotizado'),('cotizado','aprobado'),('aprobado','en_proceso'),('en_proceso','en_espera'),('en_espera','en_proceso'),('en_proceso','terminado'),('en_espera','terminado'),('terminado','cerrado'),('cerrado','en_proceso')) or p_status='cancelado';
  if not allowed then raise exception 'INVALID_TRANSITION'; end if;

  update public.maintenance_tickets set
    status=coalesce(p_status,status), priority=coalesce(p_priority,priority),
    responsible_profile_id=case when p_responsible_change then p_responsible_profile_id else responsible_profile_id end,
    resolution_summary=coalesce(p_resolution_summary,resolution_summary),
    first_attended_at=case when old_status='nuevo' and p_status='revisado' then coalesce(first_attended_at,now()) else first_attended_at end,
    resolved_at=case when p_status='terminado' then now() else resolved_at end,
    closed_at=case when p_status='cerrado' then now() else closed_at end,
    reopened_at=case when old_status='cerrado' and p_status='en_proceso' then now() else reopened_at end,
    last_public_update_at=case when nullif(btrim(p_message),'') is not null and p_visibility='resident' then now() else last_public_update_at end,
    updated_at=now()
  where id=p_ticket_id returning * into t;

  if p_status is distinct from old_status or nullif(btrim(p_message),'') is not null then
    insert into public.maintenance_ticket_updates(ticket_id,condominio_id,actor_profile_id,visibility,body,from_status,to_status)
    values(t.id,t.condominio_id,auth.uid(),p_visibility,nullif(btrim(p_message),''),old_status,p_status);
  end if;
  if p_priority is distinct from old_priority then
    insert into public.maintenance_ticket_updates(ticket_id,condominio_id,actor_profile_id,visibility,body)
    values(t.id,t.condominio_id,auth.uid(),'internal','Prioridad actualizada');
  end if;
  if p_responsible_change and p_responsible_profile_id is distinct from old_responsible then
    insert into public.maintenance_ticket_updates(ticket_id,condominio_id,actor_profile_id,visibility,body)
    values(t.id,t.condominio_id,auth.uid(),'internal',case when p_responsible_profile_id is null then 'Responsable retirado' else 'Responsable actualizado' end);
  end if;
  return t;
end $$;

revoke all on function public.condominium_admin_update_incident_v1(uuid,uuid,text,text,uuid,boolean,text,text,text) from public,anon;
grant execute on function public.condominium_admin_update_incident_v1(uuid,uuid,text,text,uuid,boolean,text,text,text) to authenticated,service_role;
revoke execute on function public.condominium_update_incident_v1(uuid,uuid,text,text,uuid,text,text,text) from authenticated;
commit;
