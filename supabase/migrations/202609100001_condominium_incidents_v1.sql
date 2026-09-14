-- Incidencias V1. Frontera temporal: condominio_id. Evolución futura:
-- organization/administrator -> condominium -> unit.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $$ begin
  if to_regclass('public.maintenance_tickets') is null
     or to_regclass('public.unidades_condominio') is null
     or to_regclass('public.condominium_unit_portal_access') is null
     or to_regprocedure('public.condominium_internal_permission(text,boolean)') is null
     or to_regprocedure('public.condominium_owner_has_unit(uuid,uuid)') is null then
    raise exception 'INCIDENTS_V1_UNEXPECTED_BASELINE';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='maintenance_tickets' and column_name='unidad_id') then
    raise exception 'INCIDENTS_V1_ALREADY_PRESENT';
  end if;
end $$;

alter table public.maintenance_tickets
  add column unidad_id uuid null references public.unidades_condominio(id) on delete restrict,
  add column reporter_profile_id uuid null references public.profiles(id) on delete restrict,
  add column responsible_profile_id uuid null references public.profiles(id) on delete restrict,
  add column idempotency_key uuid null,
  add column incident_origin text null,
  add column resolution_summary text null,
  add column first_attended_at timestamptz null,
  add column resolved_at timestamptz null,
  add column closed_at timestamptz null,
  add column reopened_at timestamptz null,
  add column last_public_update_at timestamptz null,
  add column legacy_record boolean not null default true;

alter table public.maintenance_tickets drop constraint maintenance_tickets_status_check;
alter table public.maintenance_tickets add constraint maintenance_tickets_status_check check(status=any(array['nuevo','revisado','cotizado','aprobado','en_proceso','en_espera','terminado','cerrado','cancelado']));
alter table public.maintenance_tickets add constraint maintenance_ticket_v1_scope_check check(
  legacy_record or (condominio_id is not null and unidad_id is not null and incident_origin in ('resident_portal','administration') and idempotency_key is not null)
);
alter table public.maintenance_tickets add constraint maintenance_ticket_v1_resolution_check check(status not in ('terminado','cerrado') or legacy_record or length(btrim(resolution_summary))>=5);
create unique index maintenance_ticket_v1_idempotency_idx on public.maintenance_tickets(condominio_id,idempotency_key) where not legacy_record;
create index maintenance_ticket_v1_scope_idx on public.maintenance_tickets(condominio_id,unidad_id,status,created_at desc) where not legacy_record;

create table public.maintenance_categories(
  id uuid primary key default gen_random_uuid(), condominio_id uuid not null references public.condominios(id) on delete restrict,
  code text not null check(code ~ '^[a-z0-9_]{2,40}$'), name text not null check(length(btrim(name)) between 2 and 80),
  active boolean not null default true, sort_order integer not null default 0, created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(id) on delete restrict, unique(condominio_id,code), unique(id,condominio_id)
);
create table public.maintenance_ticket_updates(
  id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.maintenance_tickets(id) on delete restrict,
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  visibility text not null check(visibility in ('resident','internal')), body text null check(body is null or length(btrim(body)) between 1 and 4000),
  from_status text null, to_status text null, created_at timestamptz not null default now(),
  check(body is not null or to_status is not null)
);
create index maintenance_ticket_updates_timeline_idx on public.maintenance_ticket_updates(ticket_id,created_at);
create table public.maintenance_ticket_evidence(
  id uuid primary key, ticket_id uuid not null references public.maintenance_tickets(id) on delete restrict,
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  unidad_id uuid not null references public.unidades_condominio(id) on delete restrict,
  update_id uuid null references public.maintenance_ticket_updates(id) on delete restrict,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  visibility text not null default 'resident' check(visibility in ('resident','internal')),
  storage_path text not null unique, mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
  size_bytes integer not null check(size_bytes between 1 and 5242880), sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(), voided_at timestamptz null, void_reason text null,
  unique(ticket_id,sha256)
);
create index maintenance_ticket_evidence_ticket_idx on public.maintenance_ticket_evidence(ticket_id,created_at);

create or replace function public.maintenance_ticket_v1_scope_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.legacy_record then return new; end if;
  if not exists(select 1 from public.unidades_condominio u where u.id=new.unidad_id and u.condominio_id=new.condominio_id and u.activo=true) then
    raise exception using errcode='42501',message='UNIT_ACCESS_DENIED';
  end if;
  return new;
end $$;
create trigger maintenance_ticket_v1_scope_guard before insert or update of condominio_id,unidad_id on public.maintenance_tickets for each row execute function public.maintenance_ticket_v1_scope_guard();

create or replace function public.maintenance_incident_actor_can_read(p_condominio_id uuid,p_unidad_id uuid,p_internal_only boolean default false)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and (
    public.condominium_internal_permission('condominios',false)
    or (not p_internal_only and public.condominium_owner_has_unit(p_condominio_id,p_unidad_id))
    or (not p_internal_only and public.condominium_transition_viewer_permission(p_condominio_id,'transition'))
  )
$$;
revoke all on function public.maintenance_incident_actor_can_read(uuid,uuid,boolean) from public,anon;
grant execute on function public.maintenance_incident_actor_can_read(uuid,uuid,boolean) to authenticated,service_role;

create or replace function public.condominium_create_incident_v1(
  p_ticket_id uuid,p_condominio_id uuid,p_unidad_id uuid,p_category_id uuid,p_title text,p_description text,p_priority text,
  p_origin text,p_idempotency_key uuid,p_evidence_id uuid default null,p_evidence_path text default null,p_evidence_sha256 text default null,
  p_evidence_mime_type text default null,p_evidence_size_bytes integer default null
) returns public.maintenance_tickets language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.maintenance_tickets; internal_ok boolean:=public.condominium_internal_permission('condominios',true);
begin
  if auth.uid() is null or not (internal_ok or public.condominium_owner_has_unit(p_condominio_id,p_unidad_id)) then raise exception 'UNIT_ACCESS_DENIED'; end if;
  if p_origin='resident_portal' and internal_ok then null;
  elsif p_origin='administration' and not internal_ok then raise exception 'OPERATION_NOT_ALLOWED'; end if;
  if p_category_id is not null and not exists(select 1 from public.maintenance_categories c where c.id=p_category_id and c.condominio_id=p_condominio_id and c.active) then raise exception 'CATEGORY_NOT_ALLOWED'; end if;
  insert into public.maintenance_tickets(id,condominio_id,unidad_id,reporter_profile_id,title,description,category,priority,status,created_by,idempotency_key,incident_origin,legacy_record,payer)
  values(p_ticket_id,p_condominio_id,p_unidad_id,auth.uid(),btrim(p_title),btrim(p_description),(select code from public.maintenance_categories where id=p_category_id),p_priority,'nuevo',auth.uid()::text,p_idempotency_key,p_origin,false,'propietario')
  on conflict(condominio_id,idempotency_key) where not legacy_record do update set id=public.maintenance_tickets.id
  returning * into t;
  if t.id<>p_ticket_id then raise exception 'DUPLICATE_INCIDENT'; end if;
  insert into public.maintenance_ticket_updates(ticket_id,condominio_id,actor_profile_id,visibility,body,to_status) values(t.id,p_condominio_id,auth.uid(),'resident','Incidencia registrada','nuevo');
  if p_evidence_id is not null then
    insert into public.maintenance_ticket_evidence(id,ticket_id,condominio_id,unidad_id,uploaded_by,visibility,storage_path,mime_type,size_bytes,sha256)
    values(p_evidence_id,t.id,p_condominio_id,p_unidad_id,auth.uid(),'resident',p_evidence_path,p_evidence_mime_type,p_evidence_size_bytes,p_evidence_sha256);
  end if;
  return t;
end $$;

create or replace function public.condominium_update_incident_v1(p_ticket_id uuid,p_condominio_id uuid,p_status text default null,p_priority text default null,p_responsible_profile_id uuid default null,p_message text default null,p_visibility text default 'internal',p_resolution_summary text default null)
returns public.maintenance_tickets language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.maintenance_tickets; old_status text; allowed boolean;
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios',true) then raise exception 'OPERATION_NOT_ALLOWED'; end if;
  select * into t from public.maintenance_tickets where id=p_ticket_id and condominio_id=p_condominio_id and not legacy_record for update;
  if not found then raise exception 'TICKET_NOT_FOUND'; end if; old_status:=t.status;
  allowed:=p_status is null or p_status=old_status or (old_status,p_status) in (('nuevo','revisado'),('revisado','en_proceso'),('revisado','cotizado'),('cotizado','aprobado'),('aprobado','en_proceso'),('en_proceso','en_espera'),('en_espera','en_proceso'),('en_proceso','terminado'),('en_espera','terminado'),('terminado','cerrado'),('cerrado','en_proceso')) or p_status='cancelado';
  if not allowed then raise exception 'INVALID_TRANSITION'; end if;
  update public.maintenance_tickets set status=coalesce(p_status,status),priority=coalesce(p_priority,priority),responsible_profile_id=coalesce(p_responsible_profile_id,responsible_profile_id),resolution_summary=coalesce(p_resolution_summary,resolution_summary),
    first_attended_at=case when old_status='nuevo' and p_status='revisado' then coalesce(first_attended_at,now()) else first_attended_at end,
    resolved_at=case when p_status='terminado' then now() else resolved_at end,closed_at=case when p_status='cerrado' then now() else closed_at end,reopened_at=case when old_status='cerrado' and p_status='en_proceso' then now() else reopened_at end,
    last_public_update_at=case when p_message is not null and p_visibility='resident' then now() else last_public_update_at end,updated_at=now()
  where id=p_ticket_id returning * into t;
  if p_message is not null or p_status is distinct from old_status then insert into public.maintenance_ticket_updates(ticket_id,condominio_id,actor_profile_id,visibility,body,from_status,to_status) values(t.id,t.condominio_id,auth.uid(),p_visibility,nullif(btrim(p_message),''),old_status,p_status); end if;
  return t;
end $$;

revoke all on function public.condominium_create_incident_v1(uuid,uuid,uuid,uuid,text,text,text,text,uuid,uuid,text,text,text,integer) from public,anon;
revoke all on function public.condominium_update_incident_v1(uuid,uuid,text,text,uuid,text,text,text) from public,anon;
grant execute on function public.condominium_create_incident_v1(uuid,uuid,uuid,uuid,text,text,text,text,uuid,uuid,text,text,text,integer),public.condominium_update_incident_v1(uuid,uuid,text,text,uuid,text,text,text) to authenticated,service_role;

alter table public.maintenance_tickets enable row level security; alter table public.maintenance_tickets force row level security;
alter table public.maintenance_categories enable row level security; alter table public.maintenance_categories force row level security;
alter table public.maintenance_ticket_updates enable row level security; alter table public.maintenance_ticket_updates force row level security;
alter table public.maintenance_ticket_evidence enable row level security; alter table public.maintenance_ticket_evidence force row level security;
revoke all on public.maintenance_categories,public.maintenance_ticket_updates,public.maintenance_ticket_evidence from public,anon,authenticated;
grant select on public.maintenance_categories,public.maintenance_ticket_updates,public.maintenance_ticket_evidence to authenticated;
grant all on public.maintenance_categories,public.maintenance_ticket_updates,public.maintenance_ticket_evidence to service_role;
create policy maintenance_categories_read on public.maintenance_categories for select to authenticated using(public.maintenance_incident_actor_can_read(condominio_id,null,false));
create policy maintenance_updates_read on public.maintenance_ticket_updates for select to authenticated using(exists(select 1 from public.maintenance_tickets t where t.id=ticket_id and public.maintenance_incident_actor_can_read(t.condominio_id,t.unidad_id,visibility='internal')));
create policy maintenance_evidence_read on public.maintenance_ticket_evidence for select to authenticated using(voided_at is null and public.maintenance_incident_actor_can_read(condominio_id,unidad_id,visibility='internal'));

drop policy if exists maintenance_hardened_delete on public.maintenance_tickets;
drop policy if exists maintenance_hardened_update on public.maintenance_tickets;
drop policy if exists maintenance_hardened_select on public.maintenance_tickets;
create policy maintenance_hardened_select on public.maintenance_tickets for select to authenticated using(
  (legacy_record and (public.condominium_internal_permission('mantenimiento',false) or (condominio_id is not null and public.condominium_transition_viewer_permission(condominio_id,'transition'))))
  or (not legacy_record and public.maintenance_incident_actor_can_read(condominio_id,unidad_id,false))
);
create policy maintenance_hardened_update on public.maintenance_tickets for update to authenticated
using(legacy_record and public.condominium_internal_permission('mantenimiento',true))
with check(legacy_record and public.condominium_internal_permission('mantenimiento',true));
create policy maintenance_hardened_delete on public.maintenance_tickets for delete to authenticated
using(legacy_record and public.condominium_internal_permission('mantenimiento',true));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('condominium-incident-evidence','condominium-incident-evidence',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
revoke all on storage.objects from anon;
drop policy if exists condominium_incident_evidence_direct_access on storage.objects;

commit;
