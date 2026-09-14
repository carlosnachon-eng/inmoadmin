-- Sólo antes de actividad V1 real. Preserva siempre tickets legacy.
begin;
do $$ begin
  if exists(select 1 from public.maintenance_tickets where legacy_record=false)
     or exists(select 1 from public.maintenance_ticket_updates)
     or exists(select 1 from public.maintenance_ticket_evidence)
     or exists(select 1 from public.maintenance_categories)
     or exists(select 1 from storage.objects where bucket_id='condominium-incident-evidence') then
    raise exception 'ROLLBACK_ABORTED_INCIDENT_V1_ACTIVITY_EXISTS';
  end if;
end $$;
-- Retirar primero las policies que dependen de columnas/helpers V1.
drop policy if exists maintenance_hardened_delete on public.maintenance_tickets;
drop policy if exists maintenance_hardened_update on public.maintenance_tickets;
drop policy if exists maintenance_hardened_select on public.maintenance_tickets;
drop policy if exists maintenance_evidence_read on public.maintenance_ticket_evidence;
drop policy if exists maintenance_updates_read on public.maintenance_ticket_updates;
drop policy if exists maintenance_categories_read on public.maintenance_categories;
drop function if exists public.condominium_update_incident_v1(uuid,uuid,text,text,uuid,text,text,text);
drop function if exists public.condominium_create_incident_v1(uuid,uuid,uuid,uuid,text,text,text,text,uuid,uuid,text,text,text,integer);
drop function if exists public.maintenance_incident_actor_can_read(uuid,uuid,boolean);
drop table public.maintenance_ticket_evidence;
drop table public.maintenance_ticket_updates;
drop table public.maintenance_categories;
drop trigger if exists maintenance_ticket_v1_scope_guard on public.maintenance_tickets;
drop function if exists public.maintenance_ticket_v1_scope_guard();
alter table public.maintenance_tickets drop constraint maintenance_ticket_v1_resolution_check,drop constraint maintenance_ticket_v1_scope_check;
drop index if exists public.maintenance_ticket_v1_idempotency_idx; drop index if exists public.maintenance_ticket_v1_scope_idx;
alter table public.maintenance_tickets drop constraint maintenance_tickets_status_check;
alter table public.maintenance_tickets drop column unidad_id,drop column reporter_profile_id,drop column responsible_profile_id,drop column idempotency_key,drop column incident_origin,drop column resolution_summary,drop column first_attended_at,drop column resolved_at,drop column closed_at,drop column reopened_at,drop column last_public_update_at,drop column legacy_record;
alter table public.maintenance_tickets add constraint maintenance_tickets_status_check check(status=any(array['nuevo','revisado','cotizado','aprobado','en_proceso','terminado','cerrado','cancelado']));

-- Baseline posterior al Portal Condómino MVP.
alter table public.maintenance_tickets enable row level security;
alter table public.maintenance_tickets no force row level security;
revoke all on public.maintenance_tickets from public,anon,authenticated;
grant select,insert,update,delete on public.maintenance_tickets to authenticated;
grant all privileges on public.maintenance_tickets to service_role;
create policy maintenance_hardened_select on public.maintenance_tickets for select to authenticated using (
  public.condominium_internal_permission('mantenimiento',false)
  or (condominio_id is not null and not public.condominium_is_controlled(condominio_id) and public.condominium_owner_has_unit(condominio_id,null))
  or (condominio_id is null and public.condominium_auth_email()<>'' and (
    exists(select 1 from public.contracts c where lower(coalesce(c.tenant_email,''))=public.condominium_auth_email() and c.status='activo' and c.property_name=maintenance_tickets.property_name)
    or exists(select 1 from public.properties p where lower(coalesce(p.owner_email,''))=public.condominium_auth_email() and p.name=maintenance_tickets.property_name)
  ))
);
-- maintenance_hardened_insert no es reemplazada por V1; se conserva en sitio.
create policy maintenance_hardened_update on public.maintenance_tickets for update to authenticated using(public.condominium_internal_permission('mantenimiento',true)) with check(public.condominium_internal_permission('mantenimiento',true));
create policy maintenance_hardened_delete on public.maintenance_tickets for delete to authenticated using(public.condominium_internal_permission('mantenimiento',true));
-- Supabase bloquea el DELETE directo de storage.buckets mediante protect_delete().
-- Tras COMMIT, eliminar el bucket vacío exclusivamente mediante Storage API y
-- ejecutar 202609100005_condominium_incidents_v1_rollback_certification.sql.
commit;
