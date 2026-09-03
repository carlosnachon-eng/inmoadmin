begin;

-- Solo reactiva la visibilidad administrativa. No recrea cobros ni comisiones
-- eliminados, porque hacerlo sin revisión podría inventar obligaciones.
update public.properties
set administration_ended_at = null
where administration_ended_at = date '2026-08-31';

drop index if exists public.idx_properties_administration_ended_at;

alter table public.properties
  drop column if exists administration_ended_at;

commit;
