-- DOCUMENTACIÓN DE ROLLBACK EXACTO DE EMERGENCIA — NO EJECUTABLE.
-- Restaurar el baseline anterior reabre lectura y escritura global, incluido
-- anon DML/TRUNCATE. Requiere autorización P0 independiente y ventana de
-- incidente. Este archivo aborta siempre para impedir ejecución accidental.

do $$
begin
  raise exception 'ROLLBACK EXACTO DESHABILITADO: requiere autorización P0 y procedimiento manual conciliado';
end $$;

-- Snapshot histórico de referencia, deliberadamente comentado:
-- drop policy if exists profiles_self_select on public.profiles;
-- drop policy if exists profiles_internal_directory_select on public.profiles;
-- drop function if exists public.profiles_is_active_internal_reader();
-- grant select, insert, update, delete, truncate, references, trigger
--   on public.profiles to anon, authenticated, service_role;
-- create policy "allow all profiles" on public.profiles
--   for all to public using (true) with check (true);
