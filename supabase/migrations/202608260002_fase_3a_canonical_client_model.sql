-- Fase 3A — Canonical Client Model externo, desacoplado de Auth.
-- Infraestructura únicamente: sin seed, backfill ni activación de flags.
begin;

create extension if not exists pgcrypto;

create table public.client_identities (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active' check (status in ('active','conflict','revoked')),
  auth_user_id uuid null references auth.users(id) on delete set null,
  phone_digest text null check (phone_digest is null or phone_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz null,
  check ((status = 'revoked') = (revoked_at is not null))
);
create unique index client_identities_auth_user_uidx on public.client_identities(auth_user_id) where auth_user_id is not null;
create index client_identities_phone_digest_idx on public.client_identities(phone_digest) where phone_digest is not null and status = 'active';

create table public.client_identity_roles (
  client_identity_id uuid not null references public.client_identities(id) on delete restrict,
  role_kind text not null check (role_kind in ('tenant','owner')),
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz null,
  primary key (client_identity_id, role_kind),
  check ((status = 'revoked') = (revoked_at is not null))
);

create table public.client_source_links (
  id uuid primary key default gen_random_uuid(),
  client_identity_id uuid not null references public.client_identities(id) on delete restrict,
  source_type text not null check (source_type in ('active_contract_tenant','managed_property_owner')),
  source_id uuid not null,
  role_kind text not null check (role_kind in ('tenant','owner')),
  link_status text not null check (link_status in ('confirmed','revoked')),
  match_method text not null check (match_method in ('exact_full_phone_human_confirmed','human_resolution')),
  confirmed_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id),
  check ((link_status = 'revoked') = (revoked_at is not null))
);
create index client_source_links_identity_idx on public.client_source_links(client_identity_id, link_status);

create table public.client_reconciliation_candidates (
  id uuid primary key default gen_random_uuid(),
  candidate_key text not null unique check (candidate_key ~ '^[a-f0-9]{64}$'),
  role_kind text not null check (role_kind in ('tenant','owner')),
  phone_digest text null check (phone_digest is null or phone_digest ~ '^[a-f0-9]{64}$'),
  candidate_status text not null check (candidate_status in ('auto_safe_candidate','requires_review','confirmed','conflict','skipped','revoked')),
  reason_code text not null check (reason_code ~ '^[a-z0-9_]{3,80}$'),
  source_count integer not null check (source_count between 1 and 100),
  client_identity_id uuid null references public.client_identities(id) on delete restrict,
  reviewed_by uuid null references public.profiles(id) on delete restrict,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index client_reconciliation_candidates_status_idx on public.client_reconciliation_candidates(candidate_status, created_at desc);

create table public.client_reconciliation_candidate_sources (
  candidate_id uuid not null references public.client_reconciliation_candidates(id) on delete restrict,
  source_type text not null check (source_type in ('active_contract_tenant','managed_property_owner')),
  source_id uuid not null,
  matched_property_id uuid null references public.properties(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (candidate_id, source_type, source_id),
  unique (source_type, source_id)
);

create table public.client_identity_audit (
  id uuid primary key default gen_random_uuid(),
  client_identity_id uuid null references public.client_identities(id) on delete restrict,
  candidate_id uuid null references public.client_reconciliation_candidates(id) on delete restrict,
  event_type text not null check (event_type in ('candidate_prepared','confirmed','rejected','conflict_marked','skipped','revoked','identity_resolved','identity_unresolved')),
  actor_profile_id uuid null references public.profiles(id) on delete restrict,
  context_ids jsonb not null default '{}'::jsonb check (jsonb_typeof(context_ids) = 'object'),
  created_at timestamptz not null default now()
);
create index client_identity_audit_created_idx on public.client_identity_audit(created_at desc);
create unique index client_identity_audit_candidate_prepared_uidx
  on public.client_identity_audit(candidate_id,event_type) where event_type='candidate_prepared';

alter table public.contracts add column tenant_client_id uuid null references public.client_identities(id) on delete restrict;
create index contracts_tenant_client_idx on public.contracts(tenant_client_id) where tenant_client_id is not null;
alter table public.properties add column owner_client_id uuid null references public.client_identities(id) on delete restrict;
create index properties_owner_client_idx on public.properties(owner_client_id) where owner_client_id is not null;

alter table public.respond_identity_links add column client_identity_id uuid null references public.client_identities(id) on delete restrict;
alter table public.respond_identity_links alter column inmoadmin_client_id drop not null;
alter table public.respond_identity_links drop constraint if exists respond_identity_links_subject_check;
alter table public.respond_identity_links add constraint respond_identity_links_subject_check check (
  client_identity_id is not null or inmoadmin_client_id is not null
);
create index respond_identity_links_client_identity_idx on public.respond_identity_links(client_identity_id) where client_identity_id is not null;

drop function if exists public.find_respond_identity_candidates(text);
create function public.find_respond_identity_candidates(p_phone_digest text)
returns table(client_identity_id uuid, contract_id uuid, property_id uuid, role_kind text)
language sql security definer
set search_path = public, pg_temp
as $$
  select distinct ci.id,c.id,c.property_id,'tenant'::text
  from public.client_identities ci
  join public.client_identity_roles r on r.client_identity_id=ci.id and r.role_kind='tenant' and r.status='active'
  join public.contracts c on c.tenant_client_id=ci.id and lower(coalesce(c.status,'')) in ('activo','active')
  where ci.status='active' and ci.phone_digest=p_phone_digest
    and exists(select 1 from public.client_source_links sl where sl.client_identity_id=ci.id and sl.link_status='confirmed')
  union all
  select distinct ci.id,null::uuid,p.id,'owner'::text
  from public.client_identities ci
  join public.client_identity_roles r on r.client_identity_id=ci.id and r.role_kind='owner' and r.status='active'
  join public.properties p on p.owner_client_id=ci.id
  where ci.status='active' and ci.phone_digest=p_phone_digest
    and exists(select 1 from public.client_source_links sl where sl.client_identity_id=ci.id and sl.link_status='confirmed');
$$;

create or replace function public.confirm_client_reconciliation_candidate(
  p_candidate_id uuid,
  p_actor_profile_id uuid,
  p_existing_identity_id uuid default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate public.client_reconciliation_candidates%rowtype;
  v_identity_id uuid;
  v_source record;
  v_updated integer;
begin
  select * into v_candidate from public.client_reconciliation_candidates where id = p_candidate_id for update;
  if not found or v_candidate.candidate_status not in ('auto_safe_candidate','requires_review','conflict') then
    raise exception 'candidate_not_confirmable';
  end if;
  if not exists (select 1 from public.profiles where id = p_actor_profile_id) then raise exception 'actor_not_authorized'; end if;

  if p_existing_identity_id is not null then
    select id into v_identity_id from public.client_identities where id = p_existing_identity_id and status = 'active' for update;
    if not found then raise exception 'identity_not_available'; end if;
  else
    insert into public.client_identities(status, phone_digest) values ('active', v_candidate.phone_digest) returning id into v_identity_id;
  end if;

  insert into public.client_identity_roles(client_identity_id, role_kind) values (v_identity_id, v_candidate.role_kind)
  on conflict (client_identity_id, role_kind) do update set status='active', revoked_at=null, updated_at=now();

  for v_source in select * from public.client_reconciliation_candidate_sources where candidate_id = p_candidate_id for update loop
    insert into public.client_source_links(client_identity_id,source_type,source_id,role_kind,link_status,match_method,confirmed_by,confirmed_at)
    values (v_identity_id,v_source.source_type,v_source.source_id,v_candidate.role_kind,'confirmed',
      case when v_candidate.phone_digest is null then 'human_resolution' else 'exact_full_phone_human_confirmed' end,
      p_actor_profile_id,now())
    on conflict (source_type,source_id) do update set client_identity_id=excluded.client_identity_id,link_status='confirmed',
      role_kind=excluded.role_kind,match_method=excluded.match_method,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,
      revoked_at=null,updated_at=now();
    if v_source.source_type = 'active_contract_tenant' then
      update public.contracts set tenant_client_id=v_identity_id,
        property_id=coalesce(property_id,v_source.matched_property_id) where id=v_source.source_id;
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then raise exception 'candidate_source_not_found'; end if;
    elsif v_source.source_type = 'managed_property_owner' then
      update public.properties set owner_client_id=v_identity_id where id=v_source.source_id;
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then raise exception 'candidate_source_not_found'; end if;
    end if;
  end loop;

  update public.client_reconciliation_candidates set candidate_status='confirmed',client_identity_id=v_identity_id,
    reviewed_by=p_actor_profile_id,reviewed_at=now(),updated_at=now() where id=p_candidate_id;
  insert into public.client_identity_audit(client_identity_id,candidate_id,event_type,actor_profile_id,context_ids)
    values (v_identity_id,p_candidate_id,'confirmed',p_actor_profile_id,jsonb_build_object('roleKind',v_candidate.role_kind));
  return v_identity_id;
end $$;

create or replace function public.review_client_reconciliation_candidate(
  p_candidate_id uuid,
  p_actor_profile_id uuid,
  p_action text
) returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_status text; v_event text;
begin
  if p_action not in ('reject','conflict','skip','revoke') then raise exception 'invalid_review_action'; end if;
  if not exists (select 1 from public.profiles where id=p_actor_profile_id) then raise exception 'actor_not_authorized'; end if;
  v_status := case p_action when 'reject' then 'skipped' when 'conflict' then 'conflict' when 'skip' then 'skipped' else 'revoked' end;
  v_event := case p_action when 'reject' then 'rejected' when 'conflict' then 'conflict_marked' when 'skip' then 'skipped' else 'revoked' end;
  update public.client_reconciliation_candidates set candidate_status=v_status,reviewed_by=p_actor_profile_id,reviewed_at=now(),updated_at=now()
    where id=p_candidate_id;
  if not found then raise exception 'candidate_not_found'; end if;
  insert into public.client_identity_audit(candidate_id,event_type,actor_profile_id) values(p_candidate_id,v_event,p_actor_profile_id);
  return v_status;
end $$;

alter table public.client_identities enable row level security;
alter table public.client_identity_roles enable row level security;
alter table public.client_source_links enable row level security;
alter table public.client_reconciliation_candidates enable row level security;
alter table public.client_reconciliation_candidate_sources enable row level security;
alter table public.client_identity_audit enable row level security;

revoke all on public.client_identities,public.client_identity_roles,public.client_source_links,
  public.client_reconciliation_candidates,public.client_reconciliation_candidate_sources,public.client_identity_audit
  from public,anon,authenticated,service_role;
grant select,insert,update on public.client_identities,public.client_identity_roles,public.client_source_links,
  public.client_reconciliation_candidates to service_role;
grant select,insert on public.client_reconciliation_candidate_sources,public.client_identity_audit to service_role;
revoke all on function public.confirm_client_reconciliation_candidate(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.review_client_reconciliation_candidate(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.find_respond_identity_candidates(text) from public,anon,authenticated;
grant execute on function public.confirm_client_reconciliation_candidate(uuid,uuid,uuid) to service_role;
grant execute on function public.review_client_reconciliation_candidate(uuid,uuid,text) to service_role;
grant execute on function public.find_respond_identity_candidates(text) to service_role;

comment on column public.client_identities.phone_digest is 'SHA-256 del teléfono mexicano normalizado; sin teléfono en claro; protegido por RLS y sólo server-side';
comment on table public.client_identity_audit is 'Auditoría append-only sin PII del Canonical Client Model';
commit;
