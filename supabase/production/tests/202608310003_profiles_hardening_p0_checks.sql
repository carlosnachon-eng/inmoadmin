begin transaction read only;

do $$
declare
  v_policies integer;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='profiles'
      and c.relrowsecurity=true and c.relforcerowsecurity=false
  ) then
    raise exception 'CHECK: RLS de profiles no está en el estado esperado';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name='profiles'
      and grantee in ('PUBLIC','anon')
  ) then
    raise exception 'CHECK: PUBLIC/anon conservan grants sobre profiles';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name='profiles' and grantee='authenticated'
      and privilege_type<>'SELECT'
  ) or not has_table_privilege('authenticated','public.profiles','select') then
    raise exception 'CHECK: authenticated no quedó limitado a SELECT';
  end if;

  if not has_table_privilege('service_role','public.profiles','select')
     or not has_table_privilege('service_role','public.profiles','update')
     or has_table_privilege('service_role','public.profiles','insert')
     or has_table_privilege('service_role','public.profiles','delete')
     or has_table_privilege('service_role','public.profiles','truncate')
     or has_table_privilege('service_role','public.profiles','references')
     or has_table_privilege('service_role','public.profiles','trigger') then
    raise exception 'CHECK: service_role no quedó limitado a SELECT+UPDATE';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='profiles'
      and policyname in ('allow all profiles','dev_read_authenticated_profiles')
  ) then
    raise exception 'CHECK: policy permisiva anterior sigue presente';
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname='public' and tablename='profiles'
    and policyname in ('profiles_self_select','profiles_internal_directory_select')
    and cmd='SELECT' and roles='{authenticated}';
  if v_policies<>2 then
    raise exception 'CHECK: faltan policies SELECT objetivo';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='profiles' and cmd<>'SELECT'
      and policyname<>'p0_inactive_profile_gate'
  ) then
    raise exception 'CHECK: existe policy de escritura no autorizada';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='profiles_is_active_internal_reader'
      and p.prosecdef=true and p.provolatile='s'
      and p.proconfig @> array['search_path=public, pg_temp']::text[]
      and pg_get_userbyid(p.proowner)='postgres'
  ) then
    raise exception 'CHECK: helper interno inseguro o ausente';
  end if;

  if has_function_privilege('anon','public.profiles_is_active_internal_reader()','execute') then
    raise exception 'CHECK: anon puede ejecutar helper interno';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='handle_new_user'
      and p.prosecdef=true
      and p.proconfig @> array['search_path=public, pg_temp']::text[]
      and pg_get_userbyid(p.proowner)='postgres'
  ) then
    raise exception 'CHECK: handle_new_user no tiene hardening esperado';
  end if;

  if has_function_privilege('anon','public.handle_new_user()','execute')
     or has_function_privilege('authenticated','public.handle_new_user()','execute')
     or has_function_privilege('service_role','public.handle_new_user()','execute') then
    raise exception 'CHECK: handle_new_user continúa expuesto como RPC';
  end if;
  if not has_function_privilege('supabase_auth_admin','public.handle_new_user()','execute') then
    raise exception 'CHECK: supabase_auth_admin no puede ejecutar el trigger Auth';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='auth' and c.relname='users'
      and t.tgname='on_auth_user_created' and not t.tgisinternal and t.tgenabled<>'D'
  ) then
    raise exception 'CHECK: trigger Auth no está activo';
  end if;
end $$;

select 'PROFILES_HARDENING_P0_CHECKS_OK' as result;
rollback;
