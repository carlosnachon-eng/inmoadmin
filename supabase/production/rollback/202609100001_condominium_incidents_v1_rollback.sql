-- Sólo antes de actividad V1 real. Preserva siempre tickets legacy.
begin;
do $$ begin
  if exists(select 1 from public.maintenance_tickets where legacy_record=false)
     or exists(select 1 from public.maintenance_ticket_updates)
     or exists(select 1 from public.maintenance_ticket_evidence) then
    raise exception 'ROLLBACK_ABORTED_INCIDENT_V1_ACTIVITY_EXISTS';
  end if;
end $$;
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
alter table public.maintenance_tickets drop column unidad_id,drop column reporter_profile_id,drop column responsible_profile_id,drop column idempotency_key,drop column incident_origin,drop column resolution_summary,drop column first_attended_at,drop column resolved_at,drop column closed_at,drop column reopened_at,drop column last_public_update_at,drop column legacy_record;
delete from storage.buckets where id='condominium-incident-evidence' and not exists(select 1 from storage.objects where bucket_id='condominium-incident-evidence');
commit;
