-- P0: mínimo privilegio y RLS explícito para public.profiles.
-- Reconoce únicamente los baselines auditados de Producción, DEV y el estado
-- objetivo idempotente. No modifica filas de profiles.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_policy_count integer;
  v_has_allow_all boolean;
  v_has_dev_read boolean;
  v_has_inactive_gate boolean;
  v_has_self boolean;
  v_has_internal boolean;
  v_anon text[];
  v_authenticated text[];
  v_service text[];
  v_public text[];
  v_baseline text;
begin
  select count(*) into v_policy_count
  from pg_policies
  where schemaname = 'public' and tablename = 'profiles';

  select exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='allow all profiles') into v_has_allow_all;
  select exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='dev_read_authenticated_profiles') into v_has_dev_read;
  select exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='p0_inactive_profile_gate') into v_has_inactive_gate;
  select exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_self_select') into v_has_self;
  select exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_internal_directory_select') into v_has_internal;

  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='profiles'
      and policyname not in (
        'allow all profiles',
        'dev_read_authenticated_profiles',
        'p0_inactive_profile_gate',
        'profiles_self_select',
        'profiles_internal_directory_select'
      )
  ) then
    raise exception 'P0 PROFILES ABORT: policy desconocida en public.profiles';
  end if;

  if v_has_allow_all and not v_has_dev_read and not v_has_self and not v_has_internal
     and v_policy_count in (1, 2) then
    v_baseline := 'production';
    if not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='profiles' and policyname='allow all profiles'
        and cmd='ALL' and roles='{public}' and coalesce(qual,'')='true' and coalesce(with_check,'')='true'
    ) then
      raise exception 'P0 PROFILES ABORT: allow all profiles no coincide con baseline auditado';
    end if;
  elsif v_has_dev_read and v_has_inactive_gate and not v_has_allow_all and not v_has_self and not v_has_internal
        and v_policy_count=2 then
    v_baseline := 'dev';
    if not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='profiles' and policyname='dev_read_authenticated_profiles'
        and cmd='SELECT' and roles='{authenticated}' and coalesce(qual,'')='true'
    ) then
      raise exception 'P0 PROFILES ABORT: dev_read_authenticated_profiles no coincide con baseline auditado';
    end if;
  elsif v_has_self and v_has_internal and not v_has_allow_all and not v_has_dev_read
        and v_policy_count in (2, 3) then
    v_baseline := 'target';
  else
    raise exception 'P0 PROFILES ABORT: combinación de policies fuera de los baselines conocidos';
  end if;

  if v_has_inactive_gate and not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='profiles' and policyname='p0_inactive_profile_gate'
      and permissive='RESTRICTIVE' and cmd='ALL' and roles='{authenticated}'
      and coalesce(qual,'') like '%is_not_inactive_profile%'
      and coalesce(with_check,'') like '%is_not_inactive_profile%'
  ) then
    raise exception 'P0 PROFILES ABORT: p0_inactive_profile_gate no coincide con el track Phase 0';
  end if;

  select coalesce(array_agg(privilege_type::text order by privilege_type), array[]::text[])
    into v_anon
  from information_schema.role_table_grants
  where table_schema='public' and table_name='profiles' and grantee='anon';
  select coalesce(array_agg(privilege_type::text order by privilege_type), array[]::text[])
    into v_authenticated
  from information_schema.role_table_grants
  where table_schema='public' and table_name='profiles' and grantee='authenticated';
  select coalesce(array_agg(privilege_type::text order by privilege_type), array[]::text[])
    into v_service
  from information_schema.role_table_grants
  where table_schema='public' and table_name='profiles' and grantee='service_role';
  select coalesce(array_agg(privilege_type::text order by privilege_type), array[]::text[])
    into v_public
  from information_schema.role_table_grants
  where table_schema='public' and table_name='profiles' and grantee='PUBLIC';

  if cardinality(v_public) <> 0 then
    raise exception 'P0 PROFILES ABORT: PUBLIC tiene grants de tabla inesperados';
  end if;

  if v_baseline='production' and not (
    v_anon = array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]
    and v_authenticated = array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]
    and v_service = array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]
  ) then
    raise exception 'P0 PROFILES ABORT: grants productivos fuera del baseline auditado';
  elsif v_baseline='dev' and not (
    v_anon = array['REFERENCES','TRIGGER','TRUNCATE']::text[]
    and v_authenticated = array['REFERENCES','SELECT','TRIGGER','TRUNCATE']::text[]
    and v_service = array['REFERENCES','SELECT','TRIGGER','TRUNCATE']::text[]
  ) then
    raise exception 'P0 PROFILES ABORT: grants DEV fuera del baseline auditado';
  elsif v_baseline='target' and not (
    cardinality(v_anon)=0
    and v_authenticated = array['SELECT']::text[]
    and v_service = array['SELECT','UPDATE']::text[]
  ) then
    raise exception 'P0 PROFILES ABORT: grants target fuera del estado certificado';
  end if;

  if not exists (
    select 1
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='profiles'
      and c.relrowsecurity=true and c.relforcerowsecurity=false
      and pg_get_userbyid(c.relowner)='postgres'
  ) then
    raise exception 'P0 PROFILES ABORT: owner/RLS de profiles inesperado';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='handle_new_user'
      and p.prosecdef=true and pg_get_userbyid(p.proowner)='postgres'
  ) then
    raise exception 'P0 PROFILES ABORT: handle_new_user no coincide con baseline';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='auth' and c.relname='users'
      and t.tgname='on_auth_user_created' and not t.tgisinternal and t.tgenabled<>'D'
  ) then
    raise exception 'P0 PROFILES ABORT: trigger Auth ausente o deshabilitado';
  end if;
end $$;

drop policy if exists "allow all profiles" on public.profiles;
drop policy if exists dev_read_authenticated_profiles on public.profiles;
drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_internal_directory_select on public.profiles;

revoke all on table public.profiles from public, anon, authenticated, service_role;
grant select on table public.profiles to authenticated;
grant select, update on table public.profiles to service_role;

create or replace function public.profiles_is_active_internal_reader()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.profiles p
    join public.roles r on r.id=p.role_id
    where p.id=auth.uid()
      and p.active=true
      and coalesce(r.es_externo,false)=false
  )
$$;

alter function public.profiles_is_active_internal_reader() owner to postgres;
revoke all on function public.profiles_is_active_internal_reader() from public, anon;
grant execute on function public.profiles_is_active_internal_reader() to authenticated, service_role;

create policy profiles_self_select
on public.profiles
for select
to authenticated
using (id=auth.uid());

create policy profiles_internal_directory_select
on public.profiles
for select
to authenticated
using (public.profiles_is_active_internal_reader());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rol_solicitado text;
begin
  rol_solicitado := nullif(btrim(coalesce(new.raw_user_meta_data->>'rol_pretendido','')), '');

  if rol_solicitado is null then
    -- Los flujos internos legacy crean primero como asesor y asignan después
    -- cualquier rol privilegiado mediante operación administrativa server-side.
    rol_solicitado := 'asesor';
  elsif rol_solicitado in ('propietario','inquilino','condomino') then
    null;
  else
    raise exception 'AUTH_PROFILE_ROLE_NOT_ALLOWED' using errcode='22023';
  end if;

  if not exists(select 1 from public.roles r where r.id=rol_solicitado) then
    raise exception 'AUTH_PROFILE_ROLE_NOT_CONFIGURED' using errcode='22023';
  end if;

  insert into public.profiles(id,email,role,role_id)
  values(new.id,new.email,'staff',rol_solicitado);
  return new;
end;
$$;

alter function public.handle_new_user() owner to postgres;
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
grant execute on function public.handle_new_user() to supabase_auth_admin;

comment on function public.profiles_is_active_internal_reader() is
  'P0 boolean-only RLS helper: active internal profile, no PII returned.';
comment on function public.handle_new_user() is
  'Auth trigger only. EXECUTE restricted to supabase_auth_admin; not a client RPC. Accepts safe owner/tenant roles or legacy internal default asesor. Privileged external roles require server-side post-create assignment.';

commit;
