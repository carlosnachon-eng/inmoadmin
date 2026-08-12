-- DEV ONLY - Fase 2A.2-A - seguridad del complemento de Condominios.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- NUNCA ejecutar como migracion productiva.
-- No replica los grants inseguros observados en Produccion.

begin;

do $$
declare
  table_name text;
  policy_name text;
  target_tables constant text[] := array[
    'condominios',
    'unidades_condominio',
    'cuotas_condominio'
  ];
begin
  if to_regprocedure('public.current_profile_can_view_operations_work_center()') is null then
    raise exception '2A.2 Condominios DEV: falta current_profile_can_view_operations_work_center()';
  end if;

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
