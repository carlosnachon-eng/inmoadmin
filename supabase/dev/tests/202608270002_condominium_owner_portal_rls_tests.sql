-- Pruebas transaccionales con identidad y datos sintéticos. Todo se revierte.
begin;
set local statement_timeout='30s';

create temporary table portal_test_scope on commit drop as
with eligible as (
  select c.id as condominio_id,
    (array_agg(u.id order by u.numero))[1] as unit_one,
    (array_agg(u.id order by u.numero))[2] as unit_two,
    (array_agg(u.id order by u.numero))[3] as unit_three
  from public.condominios c
  join public.unidades_condominio u on u.condominio_id=c.id and u.activo=true
  group by c.id
  having count(*)>=3
)
select
  legacy.condominio_id as legacy_condominio,
  legacy.unit_one as legacy_unit,
  controlled.condominio_id as controlled_condominio,
  controlled.unit_one as controlled_unit_one,
  controlled.unit_two as controlled_unit_two,
  controlled.unit_three as controlled_unit_three,
  (
    select u.id from public.unidades_condominio u
    where u.activo=true
      and u.condominio_id not in (legacy.condominio_id,controlled.condominio_id)
    order by u.id limit 1
  ) as other_tenant_unit
from eligible legacy
join lateral (
  select e.* from eligible e
  where e.condominio_id<>legacy.condominio_id
  order by e.condominio_id limit 1
) controlled on true
where not public.condominium_is_controlled(legacy.condominio_id)
order by legacy.condominio_id
limit 1;

alter table portal_test_scope
  add column legacy_fee uuid,
  add column controlled_fee uuid,
  add column legacy_expense uuid,
  add column controlled_expense uuid,
  add column legacy_ticket uuid,
  add column controlled_ticket uuid;

do $$ begin
  if (select count(*) from portal_test_scope)<>1 then
    raise exception 'TEST: faltan dos condominios sintéticos con tres unidades';
  end if;
  if (select other_tenant_unit is null from portal_test_scope) then
    raise exception 'TEST: falta un tercer tenant para aislamiento';
  end if;
end $$;

-- La identidad sintética tiene una unidad legacy y dos unidades controladas explícitas.
update public.unidades_condominio set propietario_email='portal.mixed@example.invalid'
where id=(select legacy_unit from portal_test_scope);
update public.unidades_condominio set propietario_email='portal.fallback-only@example.invalid'
where id=(select controlled_unit_three from portal_test_scope);

insert into public.condominium_operation_controls(
  condominio_id,lifecycle_status,owner_portal_enabled,current_billing_enabled,money_movements_enabled
)
select controlled_condominio,'ready_for_activation',true,true,true from portal_test_scope
on conflict(condominio_id) do update set
  lifecycle_status=excluded.lifecycle_status,
  owner_portal_enabled=excluded.owner_portal_enabled,
  current_billing_enabled=excluded.current_billing_enabled,
  money_movements_enabled=excluded.money_movements_enabled;

insert into public.condominium_unit_portal_access(condominio_id,unidad_id,email_normalized,access_kind)
select controlled_condominio,controlled_unit_one,'portal.mixed@example.invalid','OWNER' from portal_test_scope
union all
select controlled_condominio,controlled_unit_two,'portal.mixed@example.invalid','COOWNER' from portal_test_scope;

with inserted as (
  insert into public.cuotas_condominio(condominio_id,unidad_id,periodo,monto,status)
  select legacy_condominio,legacy_unit,'2099-01',1,'pendiente' from portal_test_scope
  returning id
)
update portal_test_scope set legacy_fee=inserted.id from inserted;

with inserted as (
  insert into public.cuotas_condominio(condominio_id,unidad_id,periodo,monto,status)
  select controlled_condominio,controlled_unit_one,'2099-02',1,'pendiente' from portal_test_scope
  returning id
)
update portal_test_scope set controlled_fee=inserted.id from inserted;

with inserted as (
  insert into public.gastos_condominio(condominio_id,concepto,categoria,monto,fecha)
  select legacy_condominio,'Gasto legacy sintético','otro',1,date '2099-01-01' from portal_test_scope
  returning id
)
update portal_test_scope set legacy_expense=inserted.id from inserted;

with inserted as (
  insert into public.gastos_condominio(condominio_id,concepto,categoria,monto,fecha)
  select controlled_condominio,'Gasto controlado sintético','otro',1,date '2099-01-02' from portal_test_scope
  returning id
)
update portal_test_scope set controlled_expense=inserted.id from inserted;

with inserted as (
  insert into public.maintenance_tickets(condominio_id,title,status)
  select legacy_condominio,'Mantenimiento legacy sintético','nuevo' from portal_test_scope
  returning id
)
update portal_test_scope set legacy_ticket=inserted.id from inserted;

with inserted as (
  insert into public.maintenance_tickets(condominio_id,title,status)
  select controlled_condominio,'Mantenimiento controlado sintético','nuevo' from portal_test_scope
  returning id
)
update portal_test_scope set controlled_ticket=inserted.id from inserted;

grant select on portal_test_scope to authenticated;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','ffffffff-ffff-4fff-8fff-fffffffff101',
  'email','portal.mixed@example.invalid','role','authenticated'
)::text,true);
set local role authenticated;

-- Identidad mixta: legacy por correo y controlled sólo por relaciones explícitas.
do $$
declare legacy_count integer; controlled_count integer; target uuid;
begin
  select count(*) filter(where portal_mode='LEGACY'),count(*) filter(where portal_mode='CONTROLLED')
  into legacy_count,controlled_count
  from public.condominium_owner_portal_units();
  if legacy_count<1 or controlled_count<>2 then
    raise exception 'TEST: identidad mixta no separó legacy y dos unidades controladas';
  end if;
  select controlled_unit_one into target from portal_test_scope;
  if public.condominium_owner_portal_snapshot(target) is null then
    raise exception 'TEST: snapshot controlado autorizado vacío';
  end if;
end $$;

-- Tecaxco/legacy conserva actualización de comprobante y lectura de módulos existentes.
do $$
declare affected integer;
begin
  update public.cuotas_condominio
  set comprobante_url='https://example.invalid/legacy-proof'
  where id=(select legacy_fee from portal_test_scope);
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'TEST: Tecaxco perdió actualización legacy de comprobante'; end if;
  if (select count(*) from public.gastos_condominio where id=(select legacy_expense from portal_test_scope))<>1 then
    raise exception 'TEST: Tecaxco perdió lectura legacy de gastos';
  end if;
  if (select count(*) from public.maintenance_tickets where id=(select legacy_ticket from portal_test_scope))<>1 then
    raise exception 'TEST: Tecaxco perdió lectura legacy de mantenimiento';
  end if;
end $$;

-- Un propietario controlado no puede escribir cuotas ni leer módulos pospuestos.
do $$
declare affected integer;
begin
  update public.cuotas_condominio
  set comprobante_url='https://example.invalid/controlled-proof'
  where id=(select controlled_fee from portal_test_scope);
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'TEST: propietario controlado modificó una cuota'; end if;
  if (select count(*) from public.gastos_condominio where id=(select controlled_expense from portal_test_scope))<>0 then
    raise exception 'TEST: propietario controlado leyó gastos';
  end if;
  if (select count(*) from public.maintenance_tickets where id=(select controlled_ticket from portal_test_scope))<>0 then
    raise exception 'TEST: propietario controlado leyó mantenimiento';
  end if;
end $$;

do $$
declare target uuid;
begin
  select controlled_unit_three into target from portal_test_scope;
  begin
    perform public.condominium_owner_portal_snapshot(target);
    raise exception 'TEST: se permitió acceso a unidad controlada no relacionada';
  exception when insufficient_privilege then null;
  end;
  select other_tenant_unit into target from portal_test_scope;
  begin
    perform public.condominium_owner_portal_snapshot(target);
    raise exception 'TEST: se permitió acceso a otro tenant';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- Un correo almacenado en la unidad controlada, sin relación explícita, nunca es acceso.
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','ffffffff-ffff-4fff-8fff-fffffffff102',
  'email','portal.fallback-only@example.invalid','role','authenticated'
)::text,true);
set local role authenticated;

do $$ begin
  if public.condominium_owner_has_unit(
    (select controlled_condominio from portal_test_scope),
    (select controlled_unit_three from portal_test_scope)
  ) then raise exception 'TEST: condominio controlado aceptó correo legacy sin relación explícita'; end if;
end $$;

reset role;

update public.condominium_operation_controls set owner_portal_enabled=false
where condominio_id=(select controlled_condominio from portal_test_scope);

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','ffffffff-ffff-4fff-8fff-fffffffff101',
  'email','portal.mixed@example.invalid','role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare target uuid;
begin
  if (select count(*) from public.condominium_owner_portal_units() where portal_mode='CONTROLLED')<>0 then
    raise exception 'TEST: portal controlado apagado todavía devolvió unidades';
  end if;
  if (select count(*) from public.condominium_owner_portal_units() where portal_mode='LEGACY')<1 then
    raise exception 'TEST: apagar controlado bloqueó la experiencia legacy de identidad mixta';
  end if;
  select controlled_unit_one into target from portal_test_scope;
  begin
    perform public.condominium_owner_portal_snapshot(target);
    raise exception 'TEST: portal apagado todavía permitió snapshot controlado';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

do $$ begin
  if has_function_privilege('anon','public.condominium_owner_portal_units()','execute') then
    raise exception 'TEST: anon puede ejecutar RPC del portal';
  end if;
  if has_function_privilege('anon','public.condominium_is_controlled(uuid)','execute') then
    raise exception 'TEST: anon puede consultar el modo del condominio';
  end if;
end $$;

select 'CONDOMINIUM_OWNER_PORTAL_RLS_TESTS_OK' as result;
rollback;
