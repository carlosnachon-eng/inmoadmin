-- Synthetic DEV-only transaction. Never run on Production; final ROLLBACK mandatory.
BEGIN;
SET LOCAL statement_timeout='30s';
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM public.profiles WHERE active AND role_id='admin' LIMIT 1),true);
INSERT INTO public.recibos_apartado(id,folio,tipo,cliente_nombre,inmueble,monto,fecha,notas)
VALUES('aaaaaaaa-2525-4000-8000-000000000610','QA-REFUND-5000-4000','arrendamiento','QA DEV NO REAL','QA DEV DEVOLUCION NO REAL',5000,current_date,'ROLLBACK. No es el cierre de Amalucan.');
INSERT INTO public.cierres(id,anio,mes,propiedad,fecha_cierre,operacion,comision,cobrado,pendiente,com_vendedor,pag_vendedor,pend_vend,comision_inmobiliaria,recibo_id,vendedor,propiedad_id,advisor_profile_id)
VALUES(-252610,2026,10,'QA DEV DEVOLUCION PARCIAL NO REAL',current_date,'RENTA',5000,5000,0,1000,0,1000,4000,'aaaaaaaa-2525-4000-8000-000000000610','QA SINTETICO','aaaaaaaa-0000-4000-8000-000000000001','b3830ea0-4131-46e3-b605-d56cca653198');
INSERT INTO public.cierre_pagos(id,cierre_id,concepto,monto,fecha,notas)
VALUES('aaaaaaaa-2525-4000-8000-000000000611',-252610,'QA cobro original',5000,current_date,'NO REAL');
DO $test$ DECLARE original jsonb; receipt jsonb; payment jsonb; attrs jsonb; audit_before jsonb; result jsonb;
BEGIN
 SELECT to_jsonb(c) INTO original FROM public.cierres c WHERE id=-252610;
 SELECT to_jsonb(r) INTO receipt FROM public.recibos_apartado r WHERE id='aaaaaaaa-2525-4000-8000-000000000610';
 SELECT to_jsonb(p) INTO payment FROM public.cierre_pagos p WHERE cierre_id=-252610;
 SELECT jsonb_agg(to_jsonb(a)) INTO attrs FROM public.commercial_attributions a WHERE cierre_id=-252610;
 IF attrs IS NULL OR (SELECT count(*) FROM public.v_commercial_kpi_events WHERE event_type='CIERRE' AND event_key='-252610')<>1 THEN RAISE EXCEPTION 'missing_initial_attribution'; END IF;
 BEGIN PERFORM public.cancelar_cierre_con_devolucion_parcial(-252610,'QA devolución inválida bloqueada',5000,5000,current_date,'QA comprobante externo parcial 610'); RAISE EXCEPTION 'missing_amount_guard';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'devolucion_invalida' THEN RAISE; END IF; END;
 SELECT public.cancelar_cierre_con_devolucion_parcial(-252610,'QA póliza no aprobada, devolución externa realizada y retención neta 1000',5000,4000,current_date,'QA comprobante externo parcial 610') INTO result;
 IF result->>'status'<>'cancelado' OR (result->>'ingreso_retenido')::numeric<>1000 THEN RAISE EXCEPTION 'bad_result'; END IF;
 IF (SELECT to_jsonb(c)-ARRAY['estado','cancelacion_motivo','cancelado_en','cancelado_por','cancelacion_ingreso_retenido','cancelacion_devolucion','cancelacion_devolucion_fecha','cancelacion_devolucion_referencia'] FROM public.cierres c WHERE id=-252610)
 IS DISTINCT FROM (original-ARRAY['estado','cancelacion_motivo','cancelado_en','cancelado_por','cancelacion_ingreso_retenido','cancelacion_devolucion','cancelacion_devolucion_fecha','cancelacion_devolucion_referencia']) THEN RAISE EXCEPTION 'history_changed'; END IF;
 IF receipt IS DISTINCT FROM (SELECT to_jsonb(r) FROM public.recibos_apartado r WHERE id='aaaaaaaa-2525-4000-8000-000000000610') THEN RAISE EXCEPTION 'receipt_changed'; END IF;
 IF payment IS DISTINCT FROM (SELECT to_jsonb(p) FROM public.cierre_pagos p WHERE cierre_id=-252610) THEN RAISE EXCEPTION 'payment_changed'; END IF;
 IF attrs IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(a)) FROM public.commercial_attributions a WHERE cierre_id=-252610) THEN RAISE EXCEPTION 'attribution_changed'; END IF;
 IF (SELECT monto FROM public.v_cierre_ingresos_cancelacion WHERE cierre_id=-252610)<>1000 OR (SELECT monto FROM public.v_cierre_devoluciones WHERE cierre_id=-252610)<>4000 THEN RAISE EXCEPTION 'wrong_financial_split'; END IF;
 IF (SELECT sum(monto) FROM public.cierre_pagos WHERE cierre_id=-252610)-(SELECT monto FROM public.v_cierre_devoluciones WHERE cierre_id=-252610)<>1000 THEN RAISE EXCEPTION 'wrong_cash_net'; END IF;
 IF (SELECT count(*) FROM public.v_commercial_kpi_events WHERE event_type='CIERRE' AND event_key='-252610')<>0 THEN RAISE EXCEPTION 'kpi_leak'; END IF;
 SELECT to_jsonb(a) INTO audit_before FROM cierre_audit_private.cancelaciones a WHERE cierre_id=-252610;
 IF NOT EXISTS(SELECT 1 FROM cierre_audit_private.cancelaciones WHERE cierre_id=-252610 AND ingreso_retenido=1000 AND devolucion_monto=4000 AND comision_asesor_vigente=0 AND comision_gerente_vigente=0 AND cierre_original=original AND pagos_originales->0=payment) THEN RAISE EXCEPTION 'audit_incomplete'; END IF;
 SELECT public.cancelar_cierre_con_devolucion_parcial(-252610,'QA repetición conserva historial',5000,4000,current_date,'QA comprobante externo parcial 610') INTO result;
 IF result->>'status'<>'ya_cancelado' OR audit_before IS DISTINCT FROM (SELECT to_jsonb(a) FROM cierre_audit_private.cancelaciones a WHERE cierre_id=-252610) THEN RAISE EXCEPTION 'not_idempotent'; END IF;
 BEGIN UPDATE public.cierres SET cancelacion_devolucion=3000 WHERE id=-252610; RAISE EXCEPTION 'mutable_refund';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'cierre_cancelado_inmutable' THEN RAISE; END IF; END;
END $test$;
SELECT 'PASS' result, 'DEV synthetic transaction, rollback follows' scope, 5000 original_receipt_and_payment,4000 refund_recorded,1000 net_income,0 adviser_commission,true audit_and_attribution_preserved;
ROLLBACK;
