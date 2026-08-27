-- Pruebas transaccionales con identidad sintética. Todo se revierte.
begin;
set local statement_timeout='30s';

create temporary table portal_test_scope on commit drop as
select c.id as condominio_id,
  (array_agg(u.id order by u.numero))[1] as unit_one,
  (array_agg(u.id order by u.numero))[2] as unit_two,
  (array_agg(u.id order by u.numero))[3] as unit_three,
  (array_agg(u.id order by u.numero) filter (
    where coalesce(nullif(u.propietario_email,''),nullif(u.residente_email,'')) is not null
  ))[1] as legacy_unit,
  (array_agg(lower(coalesce(nullif(u.propietario_email,''),nullif(u.residente_email,''))) order by u.numero) filter (
    where coalesce(nullif(u.propietario_email,''),nullif(u.residente_email,'')) is not null
  ))[1] as legacy_email
from public.condominios c join public.unidades_condominio u on u.condominio_id=c.id and u.activo=true
where public.condominium_owner_portal_allowed(c.id)
  and not exists(select 1 from public.condominium_operation_controls o where o.condominio_id=c.id)
group by c.id having count(*)>=3
order by c.id limit 1;

alter table portal_test_scope add column foreign_unit uuid;
update portal_test_scope s set foreign_unit=(
  select u.id from public.unidades_condominio u
  where u.activo=true and u.condominio_id<>s.condominio_id
  order by u.id limit 1
);

grant select on portal_test_scope to authenticated;

do $$ begin
  if (select count(*) from portal_test_scope)<>1 then raise exception 'TEST: falta condominio sintético elegible'; end if;
  if (select legacy_email is null or legacy_unit is null from portal_test_scope) then
    raise exception 'TEST: falta acceso legacy sintético para Tecaxco';
  end if;
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','00000000-0000-4000-8000-000000000002',
  'email',(select legacy_email from portal_test_scope),'role','authenticated'
)::text,true);
set local role authenticated;

do $$ begin
  if not public.condominium_owner_has_unit(
    (select condominio_id from portal_test_scope),(select legacy_unit from portal_test_scope)
  ) then raise exception 'TEST: se rompió el fallback legacy de Tecaxco'; end if;
end $$;

reset role;

insert into public.condominium_unit_portal_access(condominio_id,unidad_id,email_normalized,access_kind)
select condominio_id,unit_one,'portal.multiunit@example.invalid','OWNER' from portal_test_scope
union all
select condominio_id,unit_two,'portal.multiunit@example.invalid','COOWNER' from portal_test_scope;

insert into public.condominium_operation_controls(condominio_id,owner_portal_enabled)
select condominio_id,true from portal_test_scope;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','00000000-0000-4000-8000-000000000001',
  'email','portal.multiunit@example.invalid','role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare authorized_count integer; target uuid;
begin
  select count(*) into authorized_count from public.condominium_owner_portal_units();
  if authorized_count<>2 then raise exception 'TEST: multiunidad no devolvió exactamente dos unidades'; end if;
  select unit_one into target from portal_test_scope;
  if public.condominium_owner_portal_snapshot(target) is null then raise exception 'TEST: snapshot autorizado vacío'; end if;
end $$;

do $$
declare unrelated_unit uuid;
begin
  select unit_three into unrelated_unit from portal_test_scope;
  begin
    perform public.condominium_owner_portal_snapshot(unrelated_unit);
    raise exception 'TEST: se permitió acceso a unidad no relacionada del mismo condominio';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$
declare foreign_unit uuid;
begin
  select s.foreign_unit into foreign_unit from portal_test_scope s;
  if foreign_unit is null then raise exception 'TEST: falta unidad de otro tenant'; end if;
  begin
    perform public.condominium_owner_portal_snapshot(foreign_unit);
    raise exception 'TEST: se permitió acceso a otro tenant';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','00000000-0000-4000-8000-000000000002',
  'email',(select legacy_email from portal_test_scope),'role','authenticated'
)::text,true);
set local role authenticated;

do $$ begin
  if public.condominium_owner_has_unit(
    (select condominio_id from portal_test_scope),(select legacy_unit from portal_test_scope)
  ) then raise exception 'TEST: condominio controlado aceptó correo legacy sin relación explícita'; end if;
end $$;

reset role;

update public.condominium_operation_controls set owner_portal_enabled=false
where condominio_id=(select condominio_id from portal_test_scope);

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','00000000-0000-4000-8000-000000000001',
  'email','portal.multiunit@example.invalid','role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare target uuid;
begin
  if (select count(*) from public.condominium_owner_portal_units())<>0 then
    raise exception 'TEST: portal apagado todavía devolvió unidades';
  end if;
  select unit_one into target from portal_test_scope;
  begin
    perform public.condominium_owner_portal_snapshot(target);
    raise exception 'TEST: portal apagado todavía permitió snapshot';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

do $$ begin
  if has_function_privilege('anon','public.condominium_owner_portal_units()','execute') then
    raise exception 'TEST: anon puede ejecutar RPC del portal';
  end if;
  if (select count(*) from public.condominium_unit_portal_access where email_normalized='portal.multiunit@example.invalid')<>2 then
    raise exception 'TEST: fixture multiunidad inconsistente';
  end if;
end $$;

select 'CONDOMINIUM_OWNER_PORTAL_RLS_TESTS_OK' as result;
rollback;
