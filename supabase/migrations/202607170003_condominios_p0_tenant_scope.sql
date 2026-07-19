begin;

create or replace function public.condominio_usuario_puede_tenant_actual(
  p_condominio_id uuid,
  p_accion text
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1
      from public.condominio_miembros m
     where m.user_id = auth.uid()
       and m.activo
       and (m.condominio_id is null or m.condominio_id = p_condominio_id)
       and public.condominio_rol_permite(m.rol, p_accion)
  )
$$;

revoke all on function public.condominio_usuario_puede_tenant_actual(uuid,text)
  from public, anon;
grant execute on function public.condominio_usuario_puede_tenant_actual(uuid,text)
  to authenticated, service_role;

drop policy if exists condominios_select on public.condominios;
create policy condominios_select on public.condominios for select to authenticated
using (public.condominio_usuario_puede_tenant_actual(id,'consultar'));

drop policy if exists gastos_select on public.gastos_condominio;
create policy gastos_select on public.gastos_condominio for select to authenticated
using (public.condominio_usuario_puede_tenant_actual(condominio_id,'consultar'));

drop policy if exists periodos_select on public.condominio_periodos;
create policy periodos_select on public.condominio_periodos for select to authenticated
using (public.condominio_usuario_puede_tenant_actual(condominio_id,'consultar'));

drop policy if exists auditoria_select on public.condominio_audit_log;
create policy auditoria_select on public.condominio_audit_log for select to authenticated
using (public.condominio_usuario_puede_tenant_actual(condominio_id,'exportar'));

drop policy if exists importaciones_select on public.condominio_import_batches;
create policy importaciones_select on public.condominio_import_batches for select to authenticated
using (public.condominio_usuario_puede_tenant_actual(condominio_id,'importar_unidades'));

drop policy if exists exportaciones_select on public.condominio_exportaciones;
create policy exportaciones_select on public.condominio_exportaciones for select to authenticated
using (public.condominio_usuario_puede_tenant_actual(condominio_id,'exportar'));

commit;
