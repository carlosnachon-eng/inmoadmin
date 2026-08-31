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

commit;
