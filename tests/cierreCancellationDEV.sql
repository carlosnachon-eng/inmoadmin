-- DEV ONLY: hjfwjnejbcpmknvfpdcq. Synthetic negative IDs, rollback mandatory.
begin;
create temporary table cierre251_result(result jsonb) on commit drop;
do $$
declare actor uuid; first_result jsonb; second_result jsonb; before950 jsonb; code text;
begin
 if exists(select 1 from public.cierres where id in (-251943,-251950,-251951)) then raise exception 'fixture_id_collision'; end if;
 select id into actor from public.profiles where active and role_id='admin' order by id limit 1;
 if actor is null then raise exception 'dev_admin_missing';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.cierres(id,propiedad,comision,cobrado,pendiente,fecha_cierre,anio,mes,operacion,origen)
 values(-251943,'DEV ISSUE251 SIMULADO 943',22000,0,22000,'2026-09-18',2026,9,'VENTA','manual'),
 (-251950,'DEV ISSUE251 CONTROL 950',10000,0,10000,'2026-10-09',2026,10,'VENTA','manual'),
 (-251951,'DEV ISSUE251 COBRADO',10000,100,9900,'2026-10-09',2026,10,'VENTA','manual');
 select to_jsonb(c) into before950 from public.cierres c where id=-251950;
 first_result:=public.cancelar_cierre(-251943,'Prueba sintética DEV issue 251');
 second_result:=public.cancelar_cierre(-251943,'Prueba sintética DEV issue 251');
 begin perform public.cancelar_cierre(-251951,'Prueba sintética DEV con cobros');code:='unexpected_success';
 exception when others then if SQLERRM='cobros_requieren_conciliacion' then code:='paid_blocked';else code:=SQLSTATE;end if;end;
 insert into cierre251_result values(jsonb_build_object(
 'fixture_only',true,'first',first_result->>'status','second',second_result->>'status','paid',code,
 'audit_events',(select count(*) from cierre_audit_private.cancelaciones where cierre_id=-251943),
 'active_commission',(select sum(comision) from public.cierres where id in (-251943,-251950) and estado='activo'),
 'control_unchanged',(select to_jsonb(c)=before950 from public.cierres c where id=-251950),
 'preserved_historical_commission',(select comision=22000 and pendiente=22000 from public.cierres where id=-251943)));
end $$;
select result from cierre251_result;
rollback;
