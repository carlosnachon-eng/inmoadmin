-- DEV-only. Se niega a retirar el contrato si ya existen identidades propietarias.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $$
begin
  if exists(select 1 from public.profiles where role_id='propietario') then
    raise exception 'ROLLBACK DEV: existen perfiles propietario; conservar trigger y rol';
  end if;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
delete from public.roles where id='propietario';

do $$
begin
  if to_regclass('public.partner_users') is not null
     and obj_description('public.partner_users'::regclass) =
       'DEV_ONLY_MINIMAL_PARTNER_USERS_FOR_CONDOMINIUM_OWNER_ONBOARDING_QA' then
    if exists(select 1 from public.partner_users) then
      raise exception 'No se puede retirar partner_users DEV: contiene registros.';
    end if;
    drop table public.partner_users;
  end if;
end $$;

commit;
