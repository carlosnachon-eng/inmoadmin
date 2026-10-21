-- DEV review only. No changes to original commission, receipt, attribution or payments.
alter table public.cierres add column cancelacion_ingreso_retenido numeric(14,2),
 add constraint cierre_retencion_estado check (cancelacion_ingreso_retenido is null or
 (estado='cancelado' and cancelacion_ingreso_retenido>0 and cancelacion_ingreso_retenido<>'NaN'::numeric));
alter table cierre_audit_private.cancelaciones add column ingreso_retenido numeric(14,2),
 add column cierre_original jsonb, add column pagos_originales jsonb,
 add column comision_asesor_vigente numeric(14,2), add column comision_gerente_vigente numeric(14,2);
create or replace function cierre_audit_private.guard_cierre() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  if old.estado='cancelado' then raise exception 'cierre_cancelado_inmutable'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and old.estado='cancelado' then raise exception 'cierre_cancelado_inmutable'; end if;
 if new.estado='cancelado' then
  if tg_op='INSERT' then raise exception 'usar_cancelar_cierre'; end if;
  if (to_jsonb(new)-array['estado','cancelacion_motivo','cancelado_en','cancelado_por','cancelacion_ingreso_retenido'])
    is distinct from (to_jsonb(old)-array['estado','cancelacion_motivo','cancelado_en','cancelado_por','cancelacion_ingreso_retenido'])
   or not exists(select 1 from cierre_audit_private.cancelaciones a where a.cierre_id=new.id
    and a.actor=new.cancelado_por and a.actor=auth.uid() and a.motivo=new.cancelacion_motivo
    and a.ocurrido_en=new.cancelado_en and a.transaction_id=txid_current()
    and a.ingreso_retenido is not distinct from new.cancelacion_ingreso_retenido)
  then raise exception 'usar_cancelar_cierre'; end if;
 end if;
 -- Serialize source reuse against cancellation; no receipt/signature is changed.
 if new.recibo_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('cierre-recibo:'||new.recibo_id::text,0));
 end if;
 if new.firma_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('cierre-firma:'||new.firma_id::text,0));
 end if;
 if exists(select 1 from public.cierres c where c.estado='cancelado' and c.id<>new.id
  and ((new.recibo_id is not null and c.recibo_id=new.recibo_id)
    or (new.firma_id is not null and c.firma_id=new.firma_id)))
 then raise exception 'origen_cierre_cancelado'; end if;
 return new;
end $$;

create function public.cancelar_cierre_con_ingreso_retenido(p_cierre_id bigint,p_motivo text,p_importe_esperado numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.cierres%rowtype; a cierre_audit_private.cancelaciones%rowtype;
 total numeric; pagos jsonb;
begin
 if auth.uid() is null then raise exception 'solo_admin' using errcode='42501'; end if;
 perform id from public.profiles where id=auth.uid() and active and role_id='admin' for share;
 if not found then raise exception 'solo_admin' using errcode='42501'; end if;
 if p_motivo is null or length(btrim(p_motivo)) not between 10 and 1000 then raise exception 'motivo_invalido'; end if;
 if p_importe_esperado is null or p_importe_esperado<=0 or p_importe_esperado in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
 or p_importe_esperado<>round(p_importe_esperado,2) then raise exception 'retencion_invalida'; end if;
 select * into c from public.cierres where id=p_cierre_id for update;
 if not found then raise exception 'cierre_no_encontrado'; end if;
 if c.estado='cancelado' then
  if c.cancelacion_ingreso_retenido is distinct from p_importe_esperado then raise exception 'cancelacion_tipo_distinto'; end if;
  return jsonb_build_object('status','ya_cancelado','id',c.id,'ingreso_retenido',c.cancelacion_ingreso_retenido);
 end if;
 if c.recibo_id is not null then perform pg_advisory_xact_lock(hashtextextended('cierre-recibo:'||c.recibo_id::text,0)); end if;
 if c.firma_id is not null then perform pg_advisory_xact_lock(hashtextextended('cierre-firma:'||c.firma_id::text,0)); end if;
 if exists(select 1 from public.cierres other where other.id<>c.id and other.estado='activo'
  and ((c.recibo_id is not null and other.recibo_id=c.recibo_id) or (c.firma_id is not null and other.firma_id=c.firma_id)))
 then raise exception 'origen_cierre_duplicado'; end if;
 if coalesce(c.pag_vendedor,0)<>0 or coalesce(c.gerente_pagado_monto,0)<>0 or coalesce(c.vendedor_pagado,false) or coalesce(c.gerente_pagado,false)
 then raise exception 'comisiones_pagadas_requieren_conciliacion'; end if;
 -- Parent lock serializes all payment inserts/updates/deletes via guard_pago.
 if exists(select 1 from public.cierre_pagos where cierre_id=c.id and
 (monto is null or monto<0 or monto in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or fecha is null))
 then raise exception 'cobros_requieren_conciliacion'; end if;
 select coalesce(sum(monto),0),coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb)
 into total,pagos from public.cierre_pagos p where cierre_id=c.id;
 if total<>p_importe_esperado or c.cobrado is distinct from total then raise exception 'retencion_desactualizada'; end if;
 insert into cierre_audit_private.cancelaciones(cierre_id,actor,motivo,ingreso_retenido,cierre_original,pagos_originales,comision_asesor_vigente,comision_gerente_vigente)
 values(c.id,auth.uid(),btrim(p_motivo),total,to_jsonb(c),pagos,0,0) returning * into a;
 update public.cierres set estado='cancelado',cancelacion_motivo=a.motivo,cancelado_en=a.ocurrido_en,cancelado_por=a.actor,cancelacion_ingreso_retenido=total where id=c.id;
 return jsonb_build_object('status','cancelado','id',c.id,'ingreso_retenido',total,'comision_asesor_vigente',0);
end $$;
revoke all on function public.cancelar_cierre_con_ingreso_retenido(bigint,text,numeric) from public,anon,service_role;
grant execute on function public.cancelar_cierre_con_ingreso_retenido(bigint,text,numeric) to authenticated;
-- Read through parent RLS. Financial classification is separate from commercial KPI events.
create view public.v_cierre_ingresos_cancelacion with (security_invoker=true) as
select id cierre_id, cancelacion_ingreso_retenido monto,
 (cancelado_en at time zone 'America/Mexico_City')::date fecha,recibo_id,firma_id,
 0::numeric comision_asesor_vigente,0::numeric comision_gerente_vigente
from public.cierres where estado='cancelado' and cancelacion_ingreso_retenido>0;
revoke all on public.v_cierre_ingresos_cancelacion from public,anon;
grant select on public.v_cierre_ingresos_cancelacion to authenticated,service_role;
