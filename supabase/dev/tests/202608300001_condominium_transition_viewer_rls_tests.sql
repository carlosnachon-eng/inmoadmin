-- DEV/Preview: prueba transaccional, sintética y sin persistencia.
begin;
set local statement_timeout='30s';

create temporary table transition_viewer_scope on commit drop as
select
  c.id as condominio_id,
  (select u.id from public.unidades_condominio u where u.condominio_id=c.id order by u.numero limit 1) as unidad_id,
  (select c2.id from public.condominios c2 where c2.id<>c.id order by c2.id limit 1) as otro_condominio_id
from public.condominios c
where exists(select 1 from public.condominium_operation_controls o where o.condominio_id=c.id)
  and exists(select 1 from public.unidades_condominio u where u.condominio_id=c.id)
  and exists(select 1 from public.condominium_historical_accounts h where h.condominio_id=c.id)
order by c.id limit 1;

do $$ begin
  if (select count(*) from transition_viewer_scope)<>1 or (select otro_condominio_id is null from transition_viewer_scope) then
    raise exception 'TEST: faltan Génova sintética y segundo tenant';
  end if;
end $$;

insert into public.profiles(id,email,full_name,role_id,active)
values('ffffffff-ffff-4fff-8fff-fffffffff201','antive.synthetic@example.invalid','Antive sintético','antive_transition',true);

insert into public.condominium_access_memberships(
  condominio_id,principal_user_id,access_role,can_view_units,can_view_history,
  can_view_providers,can_view_transition,can_edit_transition,active,expires_at
)
select condominio_id,'ffffffff-ffff-4fff-8fff-fffffffff201','transition_viewer',true,true,true,true,false,true,now()+interval '30 days'
from transition_viewer_scope;

insert into public.condominium_provider_preparations(condominio_id,service_category,provider_name,documentation_status)
select condominio_id,'otro','Proveedor sintético','PENDIENTE' from transition_viewer_scope;
insert into public.condominium_transition_items(condominio_id,category,title,operational_status)
select condominio_id,'ANTIVE_DESARROLLADOR','Pendiente sintético Antive','ABIERTO' from transition_viewer_scope;
insert into public.maintenance_tickets(condominio_id,title,status)
select condominio_id,'Incidencia sintética Antive','nuevo' from transition_viewer_scope;

grant select on transition_viewer_scope to authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','ffffffff-ffff-4fff-8fff-fffffffff201','email','antive.synthetic@example.invalid','role','authenticated')::text,true);
set local role authenticated;

do $$
declare target uuid; other_target uuid; affected integer;
begin
  select condominio_id,otro_condominio_id into target,other_target from transition_viewer_scope;
  if (select count(*) from public.condominios where id=target)<>1 then raise exception 'TEST: Antive no ve Génova'; end if;
  if (select count(*) from public.unidades_condominio where condominio_id=target)<1 then raise exception 'TEST: Antive no ve unidades'; end if;
  if (select count(*) from public.condominium_historical_accounts where condominio_id=target)<1 then raise exception 'TEST: Antive no ve histórico'; end if;
  if (select count(*) from public.condominium_provider_preparations where condominio_id=target)<1 then raise exception 'TEST: Antive no ve proveedores'; end if;
  if (select count(*) from public.condominium_transition_items where condominio_id=target)<1 then raise exception 'TEST: Antive no ve pendientes'; end if;
  if (select count(*) from public.maintenance_tickets where condominio_id=target)<1 then raise exception 'TEST: Antive no ve incidencias'; end if;
  if (select count(*) from public.condominios where id=other_target)<>0 then raise exception 'TEST: Antive ve otro tenant / Tecaxco'; end if;

  update public.cuotas_condominio set monto=monto where condominio_id=target;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'TEST: UPDATE de cuota permitido'; end if;
  delete from public.cuotas_condominio where condominio_id=target;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'TEST: DELETE de cuota permitido'; end if;
  begin
    insert into public.cuotas_condominio(condominio_id,unidad_id,periodo,monto,status)
    values(target,(select unidad_id from transition_viewer_scope),'2099-12',1,'pendiente');
    raise exception 'TEST: INSERT de cuota permitido';
  exception
    when insufficient_privilege then null;
    when sqlstate '55000' then null;
  end;
  if exists(select 1 from public.cuotas_condominio where condominio_id=target and periodo='2099-12') then
    raise exception 'TEST: INSERT de cuota persistió';
  end if;

  update public.condominium_transition_items set operational_status='EN_REVISION' where condominio_id=target;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'TEST: can_edit_transition=false permitió UPDATE'; end if;
end $$;

reset role;
update public.condominium_access_memberships set expires_at=now()-interval '1 second'
where principal_user_id='ffffffff-ffff-4fff-8fff-fffffffff201';
set local role authenticated;
do $$ begin
  if exists(select 1 from public.condominios) then raise exception 'TEST: membresía expirada conserva información'; end if;
end $$;
reset role;

-- Tecaxco/otro tenant permanece visible para administración interna; no se modifica.
do $$ begin
  if (select count(*) from public.condominios)<2 then raise exception 'TEST: falta Tecaxco/segundo tenant para regresión'; end if;
end $$;

select 'CONDOMINIUM_TRANSITION_VIEWER_RLS_TESTS_OK' as result;
rollback;
