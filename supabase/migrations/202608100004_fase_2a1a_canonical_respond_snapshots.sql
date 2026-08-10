begin;

drop policy if exists "gv_respond_snapshots_select_scope"
  on public.gv_respond_contact_snapshots;

create policy "gv_respond_snapshots_select_scope"
on public.gv_respond_contact_snapshots
for select
to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or (
    sales_relevant = true
    and (
      (
        public.current_profile_role_id() = 'asesor'
        and mapped_profile_id = auth.uid()
      )
      or (
        public.current_profile_role_id() = 'gerente_ventas'
        and mapped_profile_id is not null
        and public.can_supervise_profile_in_scope(
          mapped_profile_id,
          array['ventas', 'global']
        )
      )
    )
  )
);

comment on column public.gv_respond_contact_snapshots.sales_relevant is
  'Proyeccion derivada exclusiva de Work Center Ventas. No representa actividad global ni limita la persistencia canonica del contacto.';

comment on column public.gv_respond_contact_snapshots.respond_record_active is
  'Estado global del registro Respond.io. False indica que el contacto ya no pudo localizarse; no depende de su relevancia comercial.';

comment on column public.gv_respond_contact_snapshots.respond_blocked is
  'Estado global de bloqueo en Respond.io. Un contacto bloqueado puede conservar un snapshot canonico activo.';

commit;
