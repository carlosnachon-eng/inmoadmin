begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$ begin
  if to_regclass('public.owner_agent_v1_inbound_messages') is null or
     to_regclass('public.owner_agent_v1_runs') is null or
     to_regclass('public.owner_agent_v1_auto_outbound') is null or
     to_regclass('public.gv_respond_contact_snapshots') is null then
    raise exception 'owner_materials_baseline_missing';
  end if;
  if exists(select 1 from storage.buckets where id='owner-approved-materials') then
    raise exception 'owner_materials_bucket_already_exists_review_required';
  end if;
end $$;

create table public.owner_approved_material_versions (
  id uuid primary key default gen_random_uuid(),
  material_code text not null check (material_code in ('OWNER_RENT_ADMIN_PRESENTATION','OWNER_SALE_PRESENTATION')),
  version text not null check (version ~ '^[a-zA-Z0-9._-]{1,64}$'),
  filename text not null check (length(filename) between 5 and 184 and filename ~* '\.pdf$' and filename !~ E'[\\r\\n/]'),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer not null check (byte_size between 1 and 10485760),
  object_path text not null,
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  active boolean not null default false,
  check (valid_until > valid_from),
  check (object_path = material_code || '/' || sha256 || '.pdf'),
  unique(material_code,version)
);
create unique index owner_material_one_active_version on public.owner_approved_material_versions(material_code) where active;
create index owner_material_approver_idx on public.owner_approved_material_versions(approved_by);

create table public.owner_material_deliveries (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.owner_approved_material_versions(id),
  material_code text not null check (material_code in ('OWNER_RENT_ADMIN_PRESENTATION','OWNER_SALE_PRESENTATION')),
  respond_contact_id text not null check (respond_contact_id ~ '^[0-9]{1,30}$'),
  channel_id text not null check (channel_id in ('497382','497385','498219','515318')),
  stage_key text not null default 'owner_service_introduction_v1' check (stage_key='owner_service_introduction_v1'),
  inbound_message_id uuid not null references public.owner_agent_v1_inbound_messages(id),
  run_id uuid not null references public.owner_agent_v1_runs(id),
  delivery_mode text not null check (delivery_mode in ('document','temporary_link')),
  status text not null default 'reserved' check (status in ('reserved','dispatching','sent','blocked','uncertain')),
  reserved_at timestamptz not null default now(),
  dispatch_started_at timestamptz,
  link_expires_at timestamptz,
  provider_message_id text check (provider_message_id ~ '^[0-9]{1,30}$'),
  sent_at timestamptz,
  completed_at timestamptz,
  error_code text check (error_code in ('material_preflight_blocked','material_delivery_uncertain_requires_review')),
  unique(respond_contact_id,stage_key,material_code),
  check ((delivery_mode='document') = (channel_id in ('498219','515318'))),
  check (status <> 'sent' or (provider_message_id is not null and sent_at is not null and completed_at is not null)),
  check (status not in ('dispatching','sent','uncertain') or (dispatch_started_at is not null and link_expires_at is not null))
);
create index owner_material_delivery_version_idx on public.owner_material_deliveries(version_id);
create index owner_material_delivery_inbound_idx on public.owner_material_deliveries(inbound_message_id);
create index owner_material_delivery_run_idx on public.owner_material_deliveries(run_id);

create function public.guard_owner_material_version() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.active or not exists(select 1 from public.profiles where id=new.approved_by and active is true and role_id='admin') then
      raise exception 'material_admin_approval_required';
    end if;
  elsif (to_jsonb(new)-'active') is distinct from (to_jsonb(old)-'active') then
    raise exception 'material_version_immutable';
  end if;
  return new;
end $$;
create trigger owner_material_version_guard before insert or update on public.owner_approved_material_versions
for each row execute function public.guard_owner_material_version();

create function public.guard_owner_material_delivery() returns trigger language plpgsql set search_path='' as $$
declare v public.owner_approved_material_versions; b public.owner_agent_v1_inbound_messages;
begin
  if tg_op='INSERT' then
    select * into v from public.owner_approved_material_versions where id=new.version_id;
    select * into b from public.owner_agent_v1_inbound_messages where id=new.inbound_message_id;
    if new.status <> 'reserved' or new.dispatch_started_at is not null or new.link_expires_at is not null or
       new.provider_message_id is not null or new.sent_at is not null or new.completed_at is not null or new.error_code is not null or
       v.material_code is distinct from new.material_code or not v.active or
       v.valid_from > now() or v.valid_until <= now() or b.respond_contact_id is distinct from new.respond_contact_id or
       b.channel_id is distinct from new.channel_id or b.status <> 'processing' or b.occurred_at>clock_timestamp() or b.occurred_at<=clock_timestamp()-interval '24 hours' or
       not exists(select 1 from public.owner_agent_v1_runs where id=new.run_id and inbound_message_id=b.id and status='idle') or
       not exists(select 1 from public.owner_agent_v1_auto_outbound where run_id=new.run_id and inbound_message_id=b.id and status='sent' and provider_message_id is not null) then
      raise exception 'material_delivery_context_invalid';
    end if;
  else
    if (to_jsonb(new)-array['status','dispatch_started_at','link_expires_at','provider_message_id','sent_at','completed_at','error_code']) is distinct from
       (to_jsonb(old)-array['status','dispatch_started_at','link_expires_at','provider_message_id','sent_at','completed_at','error_code']) or
       not ((old.status='reserved' and new.status in ('dispatching','blocked')) or
            (old.status='dispatching' and new.status in ('sent','uncertain','blocked'))) then
      raise exception 'material_delivery_immutable';
    end if;
    if old.status='dispatching' and (new.dispatch_started_at is distinct from old.dispatch_started_at or new.link_expires_at is distinct from old.link_expires_at) then
      raise exception 'material_capability_immutable';
    end if;
  end if;
  return new;
end $$;
create trigger owner_material_delivery_guard before insert or update on public.owner_material_deliveries
for each row execute function public.guard_owner_material_delivery();

create function public.activate_owner_material_version(p_version_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare v public.owner_approved_material_versions;
begin
  select * into strict v from public.owner_approved_material_versions where id=p_version_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v.material_code,61703));
  if v.valid_from>now() or v.valid_until<=now() then raise exception 'material_version_not_current'; end if;
  update public.owner_approved_material_versions set active=false where material_code=v.material_code and active;
  update public.owner_approved_material_versions set active=true where id=v.id;
end $$;

create function public.reserve_owner_material_delivery(p_inbound_id uuid,p_run_id uuid,p_material_code text,p_delivery_mode text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v public.owner_approved_material_versions; b public.owner_agent_v1_inbound_messages; d public.owner_material_deliveries;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_material_code,61703));
  select * into strict b from public.owner_agent_v1_inbound_messages where id=p_inbound_id;
  select * into d from public.owner_material_deliveries where respond_contact_id=b.respond_contact_id and material_code=p_material_code and stage_key='owner_service_introduction_v1';
  if found then return jsonb_build_object('id',d.id,'created',false); end if;
  select * into v from public.owner_approved_material_versions where material_code=p_material_code and active and valid_from<=now() and valid_until>now();
  if not found then return null; end if;
  insert into public.owner_material_deliveries(version_id,material_code,respond_contact_id,channel_id,inbound_message_id,run_id,delivery_mode)
  values(v.id,p_material_code,b.respond_contact_id,b.channel_id,b.id,p_run_id,p_delivery_mode) returning * into d;
  return jsonb_build_object('id',d.id,'version_id',d.version_id,'created',true);
end $$;

create function public.claim_owner_material_delivery(p_delivery_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.owner_material_deliveries; b public.owner_agent_v1_inbound_messages;
begin
  select * into d from public.owner_material_deliveries where id=p_delivery_id for update;
  if not found or d.status<>'reserved' then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(d.material_code,61703));
  select * into strict b from public.owner_agent_v1_inbound_messages where id=d.inbound_message_id;
  if b.status<>'processing' or b.occurred_at<=clock_timestamp()-interval '24 hours' or
     not exists(select 1 from public.owner_approved_material_versions where id=d.version_id and active and valid_from<=now() and valid_until>now()) or
     exists(select 1 from public.owner_agent_v1_inbound_messages where respond_contact_id=d.respond_contact_id and occurred_at>b.occurred_at) or
     exists(select 1 from public.gv_respond_contact_snapshots where respond_contact_id=d.respond_contact_id and respond_last_human_outbound_at>b.occurred_at) then
    return null;
  end if;
  update public.owner_material_deliveries set status='dispatching',dispatch_started_at=clock_timestamp(),link_expires_at=clock_timestamp()+interval '1 hour'
  where id=d.id returning * into d;
  return jsonb_build_object('id',d.id,'link_expires_at',d.link_expires_at);
end $$;

alter table public.owner_approved_material_versions enable row level security;
alter table public.owner_material_deliveries enable row level security;
revoke all on public.owner_approved_material_versions,public.owner_material_deliveries from public,anon,authenticated,service_role;
grant select,insert on public.owner_approved_material_versions,public.owner_material_deliveries to service_role;
grant update(active) on public.owner_approved_material_versions to service_role;
grant update(status,dispatch_started_at,link_expires_at,provider_message_id,sent_at,completed_at,error_code) on public.owner_material_deliveries to service_role;
revoke all on function public.guard_owner_material_version(),public.guard_owner_material_delivery(),public.activate_owner_material_version(uuid),public.reserve_owner_material_delivery(uuid,uuid,text,text),public.claim_owner_material_delivery(uuid) from public,anon,authenticated,service_role;
grant execute on function public.activate_owner_material_version(uuid),public.reserve_owner_material_delivery(uuid,uuid,text,text),public.claim_owner_material_delivery(uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('owner-approved-materials','owner-approved-materials',false,10485760,array['application/pdf']);
-- Restrictive barriers also apply if an old permissive storage policy covers all buckets.
-- No anon/authenticated Storage policy is granted for this library.
create policy owner_material_objects_private on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'owner-approved-materials') with check(bucket_id<>'owner-approved-materials');

do $$ begin
  if exists(select 1 from storage.buckets where id='owner-approved-materials' and public) or
     has_table_privilege('anon','public.owner_material_deliveries','SELECT') or
     has_table_privilege('authenticated','public.owner_approved_material_versions','SELECT') or
     has_function_privilege('anon','public.reserve_owner_material_delivery(uuid,uuid,text,text)','EXECUTE') then
    raise exception 'owner_materials_acl_postcheck_failed';
  end if;
end $$;
commit;
