-- Fase 3A — Identity Bridge canónico Respond -> identidad operativa InmoAdmin.
-- No contiene seed, backfill ni activación de IA/outbound.
begin;

do $$ begin
  if to_regclass('public.users') is null
     or to_regclass('public.contracts') is null
     or to_regclass('public.properties') is null
     or to_regclass('public.shadow_conversations') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Identity Bridge requiere users, contracts, properties, shadow_conversations y profiles';
  end if;
end $$;

alter table public.shadow_conversations
  add column if not exists respond_contact_id text null;
alter table public.properties
  add column if not exists owner_phone text null;

alter table public.shadow_conversations
  drop constraint if exists shadow_conversations_respond_contact_scope_check;
alter table public.shadow_conversations
  add constraint shadow_conversations_respond_contact_scope_check check (
    respond_contact_id is null or (
      provider = 'respond_admin'
      and channel = '544519'
      and length(respond_contact_id) between 1 and 200
      and respond_contact_id !~ '[[:space:]/\\?&#]'
    )
  );
create index if not exists shadow_conversations_respond_contact_idx
  on public.shadow_conversations(respond_contact_id)
  where respond_contact_id is not null;

create table if not exists public.respond_identity_links (
  id uuid primary key default gen_random_uuid(),
  respond_contact_id text not null check (
    length(respond_contact_id) between 1 and 200
    and respond_contact_id !~ '[[:space:]/\\?&#]'
  ),
  inmoadmin_client_id uuid not null references public.users(id) on delete restrict,
  link_status text not null check (link_status in ('candidate','confirmed','rejected','revoked','conflict')),
  link_source text not null check (link_source in ('explicit_operational_link','human_confirmation','exact_phone_unique','exact_phone_conflict')),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  reason_code text not null check (reason_code ~ '^[a-z0-9_]{3,80}$'),
  confirmed_by uuid null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz null,
  reviewed_by uuid null references public.profiles(id) on delete restrict,
  reviewed_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((link_status = 'confirmed') = (confirmed_by is not null and confirmed_at is not null)),
  check ((link_status = 'revoked') = (revoked_at is not null))
);
create unique index if not exists respond_identity_links_live_pair_uidx
  on public.respond_identity_links(respond_contact_id, inmoadmin_client_id)
  where link_status in ('candidate','confirmed','conflict');
create unique index if not exists respond_identity_links_confirmed_contact_uidx
  on public.respond_identity_links(respond_contact_id)
  where link_status = 'confirmed';
create index if not exists respond_identity_links_review_idx
  on public.respond_identity_links(link_status, created_at desc);

create table if not exists public.respond_identity_audit (
  id uuid primary key default gen_random_uuid(),
  link_id uuid null references public.respond_identity_links(id) on delete restrict,
  respond_contact_id text not null,
  event_type text not null check (event_type in ('candidate_created','confirmed','rejected','revoked','conflict_detected','resolved','unresolved')),
  actor_profile_id uuid null references public.profiles(id) on delete restrict,
  context_ids jsonb not null default '{}'::jsonb check (jsonb_typeof(context_ids) = 'object'),
  conflict_count integer not null default 0 check (conflict_count between 0 and 20),
  created_at timestamptz not null default now()
);
create index if not exists respond_identity_audit_contact_created_idx
  on public.respond_identity_audit(respond_contact_id, created_at desc);

create or replace function public.identity_phone_digest(p_phone text)
returns text language sql immutable strict
set search_path = public, extensions, pg_temp
as $$
  select encode(extensions.digest(
    case
      when length(regexp_replace(p_phone, '[^0-9]', '', 'g')) = 10 then '52' || regexp_replace(p_phone, '[^0-9]', '', 'g')
      when length(regexp_replace(p_phone, '[^0-9]', '', 'g')) = 13 and regexp_replace(p_phone, '[^0-9]', '', 'g') like '521%' then '52' || substring(regexp_replace(p_phone, '[^0-9]', '', 'g') from 4)
      else regexp_replace(p_phone, '[^0-9]', '', 'g')
    end,
    'sha256'
  ), 'hex')
$$;

create or replace function public.find_respond_identity_candidates(p_phone_digest text)
returns table(inmoadmin_client_id uuid, contract_id uuid, property_id uuid, role_kind text)
language sql security definer
set search_path = public, extensions, pg_temp
as $$
  select c.tenant_id, c.id, c.property_id, 'tenant'::text
  from public.contracts c
  where c.tenant_id is not null
    and lower(coalesce(c.status,'')) in ('activo','active')
    and public.identity_phone_digest(c.tenant_phone) = p_phone_digest
  union all
  select p.owner_id, null::uuid, p.id, 'owner'::text
  from public.properties p
  where p.owner_id is not null
    and public.identity_phone_digest(p.owner_phone) = p_phone_digest
$$;

alter table public.respond_identity_links enable row level security;
alter table public.respond_identity_audit enable row level security;
revoke all on public.respond_identity_links, public.respond_identity_audit from public, anon, authenticated;
revoke all on public.respond_identity_links, public.respond_identity_audit from service_role;
grant select, insert, update on public.respond_identity_links to service_role;
grant select, insert on public.respond_identity_audit to service_role;
revoke all on function public.identity_phone_digest(text) from public, anon, authenticated, service_role;
revoke all on function public.find_respond_identity_candidates(text) from public, anon, authenticated;
grant execute on function public.find_respond_identity_candidates(text) to service_role;

comment on table public.respond_identity_links is 'Fase 3A: vínculo opaco Respond -> users; sin PII duplicada; Auto-Real sólo usa confirmed';
comment on table public.respond_identity_audit is 'Fase 3A: auditoría mínima de candidatos, revisión y uso; sin texto/PII';

commit;
