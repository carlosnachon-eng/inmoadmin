-- Turn the feature flag OFF and rebuild before rollback.
-- Removes only this increment's metadata (including any newly captured values).
BEGIN;
ALTER TABLE public.solicitudes_inquilino
  DROP CONSTRAINT solicitudes_inquilino_origen_operacion_check,
  DROP COLUMN origen_operacion,
  DROP COLUMN asesor_referencia;
ALTER TABLE public.propietarios_inmuebles
  DROP CONSTRAINT propietarios_inmuebles_origen_operacion_check,
  DROP COLUMN origen_operacion,
  DROP COLUMN asesor_referencia;
COMMIT;
