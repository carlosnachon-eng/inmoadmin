-- DEV-only: reproduce el contrato Auth que ya existe en Producción.
-- No crea usuarios, relaciones de portal ni PII.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $$
begin
  if to_regclass('public.partner_users') is null then
    create table public.partner_users (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null,
      active boolean not null default true
    );
    comment on table public.partner_users is
      'DEV_ONLY_MINIMAL_PARTNER_USERS_FOR_CONDOMINIUM_OWNER_ONBOARDING_QA';
    create index partner_users_auth_user_active_dev_idx
      on public.partner_users(auth_user_id,active);
  end if;
end $$;

alter table public.partner_users enable row level security;
revoke all on public.partner_users from public,anon,authenticated;
grant select on public.partner_users to service_role;

insert into public.roles(id,nombre,descripcion,es_externo)
values(
  'propietario',
  'Propietario',
  'Acceso externo individual al Portal Condómino',
  true
)
on conflict(id) do update set
  nombre=excluded.nombre,
  descripcion=excluded.descripcion,
  es_externo=true;

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

comment on function public.handle_new_user() is
  'Auth trigger only. EXECUTE restricted to supabase_auth_admin; not a client RPC. Accepts safe owner/tenant roles or legacy internal default asesor. Privileged external roles require server-side post-create assignment.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

commit;
