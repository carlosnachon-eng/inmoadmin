-- DEV ONLY hjfwjnejbcpmknvfpdcq. Negative IDs; every write is rolled back.
begin;
create temporary table cierre251_extended(result jsonb) on commit drop;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
declare actual text;
begin
 begin execute statement; exception when others then actual:=sqlerrm; end;
 if actual is distinct from expected then raise exception 'expected %, got %',expected,actual; end if;
end $$;
do $$
declare actor uuid; advisor uuid; team uuid; plaza uuid; attribution_before jsonb; control_before jsonb;
 original_before text; original_after text; kpi_before numeric; kpi_after numeric; zero_id uuid; r jsonb;
begin
 if exists(select 1 from public.cierres where id between -251969 and -251960) then raise exception 'fixture_collision'; end if;
 select id into actor from public.profiles where active and role_id='admin' order by id limit 1;
 select id into advisor from public.profiles where active and role_id<>'admin' order by id limit 1;
 select id,plaza_id into team,plaza from public.sales_teams where active order by id limit 1;
 if actor is null or advisor is null or team is null then raise exception 'dev_principals_missing';end if;
 select md5(string_agg(to_jsonb(c)::text,'|' order by id)) into original_before from public.cierres c;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 insert into public.cierres(id,propiedad,comision,pendiente,anio,mes,fecha_cierre,operacion,origen,vendedor)
 values(-251960,'DEV ISSUE251 EXTENDED CANCEL',22000,22000,2026,10,'2026-10-20','VENTA','manual','QA synthetic advisor'),
 (-251961,'DEV ISSUE251 EXTENDED CONTROL',10000,10000,2026,10,'2026-10-20','RENTA','manual','QA synthetic advisor'),
 (-251962,'DEV ISSUE251 EXTENDED ZERO',500,500,2026,10,'2026-10-20','RENTA','manual','QA synthetic advisor'),
 (-251963,'DEV ISSUE251 EXTENDED PAYMENT',1000,1000,2026,10,'2026-10-20','RENTA','manual','QA synthetic advisor');
 insert into public.commercial_attributions(cierre_id,plaza_id,team_id,advisor_profile_id,responsible_profile_id,occurred_at,source,created_by)
 select -251960,plaza,team,advisor,advisor,'2026-10-20T12:00:00-06:00','issue251:synthetic:rollback',actor
 where not exists(select 1 from public.commercial_attributions where cierre_id=-251960);
 select to_jsonb(a) into attribution_before from public.commercial_attributions a where cierre_id=-251960;
 assert attribution_before is not null,'synthetic_attribution_missing';
 select to_jsonb(c) into control_before from public.cierres c where id=-251961;
 select coalesce(sum(ingresos),0) into kpi_before from public.get_sales_kpis_by_scope('2026-10-20','2026-10-20',null,null);
 assert (select sum(ingresos)=22000 from public.v_commercial_kpi_events where event_key='-251960' and event_type='CIERRE'),'kpi_fixture_before';
 perform set_config('request.jwt.claim.sub',advisor::text,true);
 perform pg_temp.expect_error($s$select public.cancelar_cierre(-251960,'Prueba sintética no administrador')$s$,'solo_admin');
 perform set_config('request.jwt.claim.sub','',true);
 perform pg_temp.expect_error($s$select public.cancelar_cierre(-251960,'Prueba sintética sin sesión')$s$,'solo_admin');
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform pg_temp.expect_error($s$select public.cancelar_cierre(-251960,'     ')$s$,'motivo_invalido');
 perform pg_temp.expect_error($s$update public.cierres set estado='cancelado' where id=-251960$s$,'usar_cancelar_cierre');
 r:=public.cancelar_cierre(-251960,'Operación sintética de certificación DEV 2026-10-20');
 assert r->>'status'='cancelado','first_cancel';
 r:=public.cancelar_cierre(-251960,'Segunda solicitud sintética sin modificar auditoría');
 assert r->>'status'='ya_cancelado','idempotent';
 assert (select count(*)=1 from cierre_audit_private.cancelaciones where cierre_id=-251960),'single_audit';
 assert (select to_jsonb(a)=attribution_before from public.commercial_attributions a where cierre_id=-251960),'attribution_changed';
 assert (select to_jsonb(c)=control_before from public.cierres c where id=-251961),'control_changed';
 assert not exists(select 1 from public.v_commercial_kpi_events where event_key='-251960' and event_type='CIERRE'),'kpi_cancelled';
 select coalesce(sum(ingresos),0) into kpi_after from public.get_sales_kpis_by_scope('2026-10-20','2026-10-20',null,null);
 assert kpi_before-kpi_after=22000,'rpc_kpi_delta';
 assert not exists(select 1 from public.get_sales_kpi_events_by_scope('2026-10-20','2026-10-20',(select code from public.sales_teams where id=team)) where event_key='-251960' and event_type='CIERRE'),'rpc_events_cancelled';
 assert (select sum(comision)=11500 and sum(pendiente)=11500 from public.cierres where id between -251963 and -251960 and estado='activo'),'financial_totals';
 perform pg_temp.expect_error($s$update public.cierres set estado='activo' where id=-251960$s$,'cierre_cancelado_inmutable');
 perform pg_temp.expect_error($s$delete from public.cierres where id=-251960$s$,'cierre_cancelado_inmutable');
 perform pg_temp.expect_error($s$insert into public.cierre_pagos(cierre_id,monto) values(-251960,1)$s$,'cierre_cancelado_no_admite_pagos');
 perform pg_temp.expect_error($s$update cierre_audit_private.cancelaciones set motivo='Intento de modificación sintética' where cierre_id=-251960$s$,'cierre_audit_immutable');
 insert into public.cierre_pagos(cierre_id,monto) values(-251962,0) returning id into zero_id;
 perform public.cancelar_cierre(-251962,'Cancelación sintética con movimiento de monto cero');
 perform pg_temp.expect_error(format('delete from public.cierre_pagos where id=%L',zero_id),'cierre_cancelado_no_admite_pagos');
 perform pg_temp.expect_error(format('update public.cierre_pagos set monto=1 where id=%L',zero_id),'cierre_cancelado_no_admite_pagos');
 assert exists(select 1 from public.cierre_pagos where id=zero_id and monto=0),'zero_evidence_missing';
 insert into public.cierre_pagos(cierre_id,monto) values(-251963,100);
 perform pg_temp.expect_error($s$select public.cancelar_cierre(-251963,'Cancelación sintética con pago presente')$s$,'cobros_requieren_conciliacion');
 select md5(string_agg(to_jsonb(c)::text,'|' order by id)) into original_after from public.cierres c where id not between -251969 and -251960;
 assert original_before is not distinct from original_after,'preexisting_closures_changed';
 insert into cierre251_extended values(jsonb_build_object('result','PASS','fixture_ids',jsonb_build_array(-251960,-251961,-251962,-251963),'authorization','claim_simulation_not_browser_auth','idempotent',true,'single_audit',true,'attribution_preserved',true,'control_preserved',true,'all_preexisting_closures_unchanged',true,'kpi_rpc_income_delta',kpi_before-kpi_after,'kpi_event_excluded',true,'paid_blocked',true,'zero_movement_preserved',true,'rollback_mandatory',true));
end $$;
select result from cierre251_extended;
rollback;
