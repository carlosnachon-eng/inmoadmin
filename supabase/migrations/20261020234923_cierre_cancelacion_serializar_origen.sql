-- Refuse ambiguous duplicate origins and serialize authorisation with profile changes.
create or replace function public.cancelar_cierre(p_cierre_id bigint,p_motivo text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.cierres%rowtype; a cierre_audit_private.cancelaciones%rowtype;
begin
 -- Hold the authorisation row until commit; concurrent deactivation cannot overtake it.
 if auth.uid() is null then raise exception 'solo_admin' using errcode='42501'; end if;
 perform id from public.profiles where id=auth.uid() and active and role_id='admin' for share;
 if not found then raise exception 'solo_admin' using errcode='42501'; end if;
 if p_motivo is null or length(btrim(p_motivo)) not between 10 and 1000 then raise exception 'motivo_invalido'; end if;
 select * into c from public.cierres where id=p_cierre_id for update;
 if not found then raise exception 'cierre_no_encontrado'; end if;
 if c.estado='cancelado' then return jsonb_build_object('status','ya_cancelado','id',c.id); end if;
 -- Same locks/order as guard_cierre: the origin check sees a committed racing insert.
 if c.recibo_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('cierre-recibo:'||c.recibo_id::text,0));
 end if;
 if c.firma_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('cierre-firma:'||c.firma_id::text,0));
 end if;
 if exists(select 1 from public.cierres other where other.id<>c.id and other.estado='activo'
  and ((c.recibo_id is not null and other.recibo_id=c.recibo_id)
    or (c.firma_id is not null and other.firma_id=c.firma_id)))
 then raise exception 'origen_cierre_duplicado'; end if;
 if coalesce(c.cobrado,0)<>0 or coalesce(c.pag_vendedor,0)<>0 or coalesce(c.gerente_pagado_monto,0)<>0
  or coalesce(c.cobrado_bool,false) or coalesce(c.vendedor_pagado,false) or coalesce(c.gerente_pagado,false)
  or exists(select 1 from public.cierre_pagos where cierre_id=c.id and coalesce(monto,0)<>0)
 then raise exception 'cobros_requieren_conciliacion'; end if;
 insert into cierre_audit_private.cancelaciones(cierre_id,actor,motivo)
 values(c.id,auth.uid(),btrim(p_motivo)) returning * into a;
 update public.cierres set estado='cancelado',cancelacion_motivo=a.motivo,cancelado_en=a.ocurrido_en,cancelado_por=a.actor where id=c.id;
 return jsonb_build_object('status','cancelado','id',c.id);
end $$;
revoke all on function public.cancelar_cierre(bigint,text) from public,anon,service_role;
grant execute on function public.cancelar_cierre(bigint,text) to authenticated;
