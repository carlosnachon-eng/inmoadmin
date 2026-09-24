BEGIN;
SET LOCAL ROLE anon;
DO $$
DECLARE o text; actual text; ref text;
BEGIN
  FOREACH o IN ARRAY ARRAY['emporio','b2c','partner',NULL] LOOP
    INSERT INTO public.solicitudes_inquilino (origen_operacion, asesor_referencia)
      VALUES (o, CASE WHEN o='emporio' THEN 'Prueba sintética I1' ELSE NULL END)
      RETURNING origen_operacion, asesor_referencia INTO actual, ref;
    IF actual IS DISTINCT FROM o THEN RAISE EXCEPTION 'Tenant origin mismatch'; END IF;
    INSERT INTO public.propietarios_inmuebles (nombre_propietario,direccion_inmueble,origen_operacion,asesor_referencia)
      VALUES ('Prueba sintética I1','Inmueble sintético I1',o,CASE WHEN o='emporio' THEN 'Prueba sintética I1' ELSE NULL END)
      RETURNING origen_operacion,asesor_referencia INTO actual,ref;
    IF actual IS DISTINCT FROM o THEN RAISE EXCEPTION 'Owner origin mismatch'; END IF;
    IF o='emporio' AND ref IS DISTINCT FROM 'Prueba sintética I1' THEN RAISE EXCEPTION 'Reference mismatch'; END IF;
  END LOOP;
END $$;
ROLLBACK;
