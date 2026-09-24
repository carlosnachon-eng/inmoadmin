-- DEV first. Production application is explicitly out of scope.
-- No defaults, backfill, RLS, grants, or policies are changed.
ALTER TABLE public.solicitudes_inquilino
  ADD COLUMN origen_operacion text NULL,
  ADD COLUMN asesor_referencia text NULL,
  ADD CONSTRAINT solicitudes_inquilino_origen_operacion_check
    CHECK (origen_operacion IN ('emporio', 'b2c', 'partner'));
ALTER TABLE public.propietarios_inmuebles
  ADD COLUMN origen_operacion text NULL,
  ADD COLUMN asesor_referencia text NULL,
  ADD CONSTRAINT propietarios_inmuebles_origen_operacion_check
    CHECK (origen_operacion IN ('emporio', 'b2c', 'partner'));
