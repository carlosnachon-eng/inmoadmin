-- DEV ONLY - Fase 2A.2-0C - hardening/RLS del Centro Operativo Administrativo.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- NUNCA ejecutar como migracion productiva.

begin;

insert into public.permisos_modulo
  (id, role_id, modulo, puede_ver, puede_editar, alcance)
values
  ('2a220000-0000-4000-8000-000000000090', 'admin', 'operaciones_work_center', true, false, 'global'),
  ('2a220000-0000-4000-8000-000000000091', 'coord_operaciones', 'operaciones_work_center', true, false, 'operaciones')
on conflict (role_id, modulo) do nothing;

create or replace function public.current_profile_can_view_operations_work_center()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    join public.permisos_modulo pm
      on pm.role_id = p.role_id
     and pm.modulo = 'operaciones_work_center'
     and pm.puede_ver = true
    where p.id = auth.uid()
      and p.active is distinct from false
      and p.role_id in ('admin', 'coord_operaciones')
  );
$$;

revoke all on function public.current_profile_can_view_operations_work_center()
from public, anon, authenticated;
grant execute on function public.current_profile_can_view_operations_work_center()
to authenticated, service_role;

revoke all on function public.dev_2a2_set_updated_at()
from public, anon, authenticated;
grant execute on function public.dev_2a2_set_updated_at()
to service_role;

grant usage on schema public to authenticated, service_role;

do $$
declare
  table_name text;
  policy_name text;
  target_tables constant text[] := array[
    'users',
    'properties',
    'condominios',
    'propietarios_inmuebles',
    'plantillas_inspeccion',
    'contracts',
    'payments',
    'maintenance_tickets',
    'maintenance_quotes',
    'firmas',
    'firma_etapas',
    'firmas_citas',
    'inspecciones',
    'solicitudes_inquilino',
    'poliza_expedientes'
  ];
begin
  foreach table_name in array target_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('grant all privileges on table public.%I to service_role', table_name);

    for policy_name in
      select pol.polname
      from pg_policy pol
      join pg_class rel on rel.oid = pol.polrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public'
        and rel.relname = table_name
    loop
      execute format('drop policy %I on public.%I', policy_name, table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.current_profile_can_view_operations_work_center())',
      table_name || '_operations_work_center_select',
      table_name
    );
  end loop;
end;
$$;

commit;
