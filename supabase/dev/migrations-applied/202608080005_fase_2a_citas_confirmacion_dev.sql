-- Fase 2A DEV - Confirmacion minima de citas
-- Estado: ejecutable solo en inmoadmin-dev.
-- Objetivo: separar cita agendada de cita efectiva/realizada sin cambiar KPIs vigentes.

begin;

alter table public.citas
  add column if not exists confirmacion_estado text not null default 'pendiente_confirmar',
  add column if not exists confirmacion_actualizada_at timestamptz null,
  add column if not exists confirmacion_actualizada_por uuid null references public.profiles(id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'citas_confirmacion_estado_check'
      and conrelid = 'public.citas'::regclass
  ) then
    alter table public.citas
      add constraint citas_confirmacion_estado_check
      check (confirmacion_estado in (
        'pendiente_confirmar',
        'confirmada',
        'cancelada',
        'no_show',
        'realizada'
      ));
  end if;
end $$;

create index if not exists idx_citas_asesor_confirmacion_fecha
  on public.citas (asesor_id, confirmacion_estado, fecha_hora);

update public.citas
set
  confirmacion_estado = case
    when estado in ('efectiva', 'calificada', 'realizada') then 'realizada'
    when estado = 'cancelada' then 'cancelada'
    when estado = 'no_show' then 'no_show'
    when estado = 'confirmada' then 'confirmada'
    else 'pendiente_confirmar'
  end,
  confirmacion_actualizada_at = coalesce(confirmacion_actualizada_at, now())
where confirmacion_estado = 'pendiente_confirmar'
  and estado in ('efectiva', 'calificada', 'realizada', 'cancelada', 'no_show', 'confirmada');

comment on column public.citas.confirmacion_estado is
  'Fase 2A DEV: estado minimo para distinguir citas pendientes, confirmadas, canceladas, no-show y realizadas. No reemplaza el KPI vigente sin autorizacion.';

comment on column public.citas.confirmacion_actualizada_at is
  'Fase 2A DEV: timestamp de ultima actualizacion del estado de confirmacion de cita.';

comment on column public.citas.confirmacion_actualizada_por is
  'Fase 2A DEV: profile.id que actualizo confirmacion_estado, cuando aplique.';

commit;
