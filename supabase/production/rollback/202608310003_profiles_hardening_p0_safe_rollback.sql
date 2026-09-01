-- Rollback operativo seguro: conserva el cierre del P0.
-- Revierte únicamente la validación estricta de rol en handle_new_user y deja
-- intactos los grants/policies de mínimo privilegio.

begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name='profiles'
      and grantee in ('PUBLIC','anon')
  ) then
    raise exception 'SAFE ROLLBACK ABORTADO: detectado acceso PUBLIC/anon inesperado';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='profiles'
      and policyname='profiles_self_select' and cmd='SELECT'
  ) or not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='profiles'
      and policyname='profiles_internal_directory_select' and cmd='SELECT'
  ) then
    raise exception 'SAFE ROLLBACK ABORTADO: policies objetivo no están completas';
  end if;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rol_solicitado text;
begin
  rol_solicitado := coalesce(new.raw_user_meta_data->>'rol_pretendido','asesor');
  if not exists(select 1 from public.roles r where r.id=rol_solicitado) then
    rol_solicitado := 'asesor';
  end if;
  insert into public.profiles(id,email,role,role_id)
  values(new.id,new.email,'staff',rol_solicitado);
  return new;
end;
$$;

alter function public.handle_new_user() owner to postgres;
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
grant execute on function public.handle_new_user() to supabase_auth_admin;

comment on function public.handle_new_user() is
  'SAFE ROLLBACK: legacy role fallback restored; trigger remains non-RPC and profiles RLS remains hardened.';

commit;
