-- Synthetic only. The final ROLLBACK is mandatory; never run on Production.
BEGIN;
SET LOCAL statement_timeout='30s';
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM public.profiles WHERE active AND role_id='admin' LIMIT 1),true);
INSERT INTO public.recibos_apartado(id,folio,tipo,cliente_nombre,inmueble,monto,fecha,notas)
VALUES('aaaaaaaa-2525-4000-8000-000000000510','QA-RETENCION-25500','arrendamiento','QA RETENCION NO REAL','QA RETENCION SINTETICA',25500,current_date,'TRANSACCION ROLLBACK NO REAL');
INSERT INTO public.cierres(id,anio,mes,propiedad,fecha_cierre,operacion,comision,cobrado,pendiente,com_vendedor,pag_vendedor,pend_vend,comision_inmobiliaria,recibo_id,vendedor)
VALUES(-252510,2026,10,'QA RETENCION 25500 NO REAL',current_date,'RENTA',25500,25500,0,5100,0,5100,20400,'aaaaaaaa-2525-4000-8000-000000000510','QA SINTETICO');
INSERT INTO public.cierre_pagos(id,cierre_id,concepto,monto,fecha,notas)
VALUES('aaaaaaaa-2525-4000-8000-000000000511',-252510,'QA cobro original',25500,current_date,'NO REAL');
DO $test$ DECLARE original jsonb; receipt jsonb; payment jsonb; result jsonb;
BEGIN
 SELECT to_jsonb(c) INTO original FROM public.cierres c WHERE id=-252510;
 SELECT to_jsonb(r) INTO receipt FROM public.recibos_apartado r WHERE id='aaaaaaaa-2525-4000-8000-000000000510';
 SELECT to_jsonb(p) INTO payment FROM public.cierre_pagos p WHERE cierre_id=-252510;
 BEGIN PERFORM public.cancelar_cierre(-252510,'QA cancelacion ordinaria bloqueada'); RAISE EXCEPTION 'missing_standard_guard';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'cobros_requieren_conciliacion' THEN RAISE; END IF; END;
 BEGIN PERFORM public.cancelar_cierre_con_ingreso_retenido(-252510,'QA importe incorrecto rechazado',25000); RAISE EXCEPTION 'missing_amount_guard';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'retencion_desactualizada' THEN RAISE; END IF; END;
 SELECT public.cancelar_cierre_con_ingreso_retenido(-252510,'QA cliente cancela y retencion total inmobiliaria sin asesores',25500) INTO result;
 IF result->>'status'<>'cancelado' THEN RAISE EXCEPTION 'not_cancelled'; END IF;
 IF (SELECT to_jsonb(c)-ARRAY['estado','cancelacion_motivo','cancelado_en','cancelado_por','cancelacion_ingreso_retenido'] FROM public.cierres c WHERE id=-252510)
 IS DISTINCT FROM (original-ARRAY['estado','cancelacion_motivo','cancelado_en','cancelado_por','cancelacion_ingreso_retenido']) THEN RAISE EXCEPTION 'commercial_history_changed'; END IF;
 IF receipt IS DISTINCT FROM (SELECT to_jsonb(r) FROM public.recibos_apartado r WHERE id='aaaaaaaa-2525-4000-8000-000000000510') THEN RAISE EXCEPTION 'receipt_changed'; END IF;
 IF payment IS DISTINCT FROM (SELECT to_jsonb(p) FROM public.cierre_pagos p WHERE cierre_id=-252510) THEN RAISE EXCEPTION 'payment_changed'; END IF;
 IF (SELECT monto FROM public.v_cierre_ingresos_cancelacion WHERE cierre_id=-252510)<>25500 THEN RAISE EXCEPTION 'missing_income'; END IF;
 IF (SELECT count(*) FROM public.v_commercial_kpi_events WHERE event_type='CIERRE' AND event_key='-252510')<>0 THEN RAISE EXCEPTION 'kpi_leak'; END IF;
 IF NOT EXISTS(SELECT 1 FROM cierre_audit_private.cancelaciones WHERE cierre_id=-252510 AND ingreso_retenido=25500 AND comision_asesor_vigente=0 AND cierre_original=original AND pagos_originales->0=payment) THEN RAISE EXCEPTION 'audit_incomplete'; END IF;
 SELECT public.cancelar_cierre_con_ingreso_retenido(-252510,'QA repeticion conserva motivo original',25500) INTO result;
 IF result->>'status'<>'ya_cancelado' THEN RAISE EXCEPTION 'not_idempotent'; END IF;
 BEGIN DELETE FROM public.cierre_pagos WHERE cierre_id=-252510; RAISE EXCEPTION 'mutable_payment';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'cierre_cancelado_no_admite_pagos' THEN RAISE; END IF; END;
END $test$;
SELECT 'PASS' result, 'DEV synthetic transaction; rollback follows' scope, 25500 retained_income, 0 adviser_commission, true original_receipt_and_payment_unchanged, true audited, true idempotent;
ROLLBACK;
