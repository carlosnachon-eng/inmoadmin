-- Additive: never rewrites attribution, receipt, signature or financial history.
alter table public.cierres
 add column estado text not null default 'activo' check (estado in ('activo','cancelado')),
 add column cancelacion_motivo text,
 add column cancelado_en timestamptz,
 add column cancelado_por uuid references public.profiles(id),
 add constraint cierre_cancelacion_metadata check (
 (estado='activo' and cancelacion_motivo is null and cancelado_en is null and cancelado_por is null)
 or (estado='cancelado' and length(btrim(cancelacion_motivo)) between 10 and 1000 and cancelado_en is not null and cancelado_por is not null));
create schema if not exists cierre_audit_private;
revoke all on schema cierre_audit_private from public,anon,authenticated;
create table cierre_audit_private.cancelaciones (
 cierre_id bigint primary key references public.cierres(id),
 actor uuid not null references public.profiles(id),
 motivo text not null check(length(btrim(motivo)) between 10 and 1000),
 ocurrido_en timestamptz not null default clock_timestamp(),
 transaction_id bigint not null default txid_current()
);
alter table cierre_audit_private.cancelaciones enable row level security;
revoke all on cierre_audit_private.cancelaciones from public,anon,authenticated,service_role;
create function cierre_audit_private.immutable_event() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'cierre_audit_immutable'; end $$;
create trigger cierre_audit_immutable before update or delete on cierre_audit_private.cancelaciones
for each row execute function cierre_audit_private.immutable_event();

create function cierre_audit_private.guard_cierre() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  if old.estado='cancelado' then raise exception 'cierre_cancelado_inmutable'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and old.estado='cancelado' then raise exception 'cierre_cancelado_inmutable'; end if;
 if new.estado='cancelado' then
  if tg_op='INSERT' then raise exception 'usar_cancelar_cierre'; end if;
  if (to_jsonb(new)-array['estado','cancelacion_motivo','cancelado_en','cancelado_por'])
    is distinct from (to_jsonb(old)-array['estado','cancelacion_motivo','cancelado_en','cancelado_por'])
   or not exists(select 1 from cierre_audit_private.cancelaciones a where a.cierre_id=new.id
    and a.actor=new.cancelado_por and a.actor=auth.uid() and a.motivo=new.cancelacion_motivo
    and a.ocurrido_en=new.cancelado_en and a.transaction_id=txid_current())
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
create trigger cierre_cancelacion_guard before insert or update or delete on public.cierres
for each row execute function cierre_audit_private.guard_cierre();

create function cierre_audit_private.guard_pago() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_estado text;
begin
 if tg_op='UPDATE' and old.cierre_id is distinct from new.cierre_id then raise exception 'pago_cierre_inmutable'; end if;
 select estado into v_estado from public.cierres where id=new.cierre_id for update;
 if v_estado='cancelado' then raise exception 'cierre_cancelado_no_admite_pagos'; end if;
 return new;
end $$;
create trigger cierre_pago_cancelacion_guard before insert or update on public.cierre_pagos
for each row execute function cierre_audit_private.guard_pago();

create function public.cancelar_cierre(p_cierre_id bigint,p_motivo text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.cierres%rowtype; a cierre_audit_private.cancelaciones%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active and role_id='admin')
 then raise exception 'solo_admin' using errcode='42501'; end if;
 if p_motivo is null or length(btrim(p_motivo)) not between 10 and 1000 then raise exception 'motivo_invalido'; end if;
 select * into c from public.cierres where id=p_cierre_id for update;
 if not found then raise exception 'cierre_no_encontrado'; end if;
 if c.estado='cancelado' then return jsonb_build_object('status','ya_cancelado','id',c.id); end if;
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
revoke all on all functions in schema cierre_audit_private from public,anon,authenticated,service_role;
create or replace view public.v_commercial_kpi_events
with (security_invoker=true) as
select a.id attribution_id,'CITA'::text event_type,c.id::text event_key,a.occurred_at,a.plaza_id,p.code plaza_code,
  a.team_id,t.code team_code,a.advisor_profile_id,a.responsible_profile_id,
  1::integer citas_agendadas,
  case when c.estado in ('efectiva','calificada') then 1 else 0 end::integer citas_efectivas,
  case when c.estado='calificada' then 1 else 0 end::integer citas_calificadas,
  0::integer apartados,0::integer cierres,0::numeric ingresos
from public.commercial_attributions a join public.citas c on c.id=a.cita_id
join public.commercial_plazas p on p.id=a.plaza_id join public.sales_teams t on t.id=a.team_id
union all
select a.id,'APARTADO',r.id::text,a.occurred_at,a.plaza_id,p.code,a.team_id,t.code,a.advisor_profile_id,a.responsible_profile_id,
  0,0,0,1,0,0::numeric
from public.commercial_attributions a join public.recibos_apartado r on r.id=a.recibo_apartado_id
join public.commercial_plazas p on p.id=a.plaza_id join public.sales_teams t on t.id=a.team_id
union all
select a.id,'CIERRE',c.id::text,a.occurred_at,a.plaza_id,p.code,a.team_id,t.code,a.advisor_profile_id,a.responsible_profile_id,
  0,0,0,0,1,coalesce(c.comision,0)::numeric
from public.commercial_attributions a join public.cierres c on c.id=a.cierre_id
join public.commercial_plazas p on p.id=a.plaza_id join public.sales_teams t on t.id=a.team_id
where c.estado='activo';

