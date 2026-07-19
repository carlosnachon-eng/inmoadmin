begin;

do $$
begin
  if current_setting('app.settings.environment', true) is distinct from 'demo'
     or current_setting('app.settings.project_ref', true) is distinct from 'kmxzvcngfrzcasedtexw' then
    raise exception 'OPERACIÓN CANCELADA: EL DESTINO NO ESTÁ CONFIRMADO COMO AMBIENTE DEMO.';
  end if;
end
$$;

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permisos_modulo enable row level security;

drop policy if exists profiles_demo_self_select on public.profiles;
create policy profiles_demo_self_select on public.profiles
for select to authenticated using (id = auth.uid());

drop policy if exists roles_demo_authenticated_select on public.roles;
create policy roles_demo_authenticated_select on public.roles
for select to authenticated using (true);

drop policy if exists permisos_demo_authenticated_select on public.permisos_modulo;
create policy permisos_demo_authenticated_select on public.permisos_modulo
for select to authenticated using (true);

grant select on public.profiles, public.roles, public.permisos_modulo to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.profiles, public.roles, public.permisos_modulo from authenticated;

commit;
