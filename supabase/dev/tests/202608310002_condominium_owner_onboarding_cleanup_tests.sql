-- DEV only. Reproduce el trigger Auth real y revierte todos los fixtures.
begin;
set local statement_timeout='60s';

create temporary table cleanup_test_scope on commit drop as
select
  (select p.id from public.profiles p where p.active=true and p.role_id='admin' order by p.id limit 1) as operator_id,
  target.condominio_id,
  target.id as unidad_id,
  (
    select u.id from public.unidades_condominio u
    where u.activo=true
      and not exists(
        select 1 from public.condominium_operation_controls c
        where c.condominio_id=u.condominio_id
      )
    order by u.id limit 1
  ) as legacy_unit_id
from lateral (
  select u.id,u.condominio_id from public.unidades_condominio u
  where u.activo=true order by u.id limit 1
) target;

do $$
begin
  if (select count(*) from cleanup_test_scope)<>1
     or (select operator_id is null or condominio_id is null or unidad_id is null or legacy_unit_id is null from cleanup_test_scope) then
    raise exception 'TEST: faltan fixtures DEV para cleanup de onboarding';
  end if;
end $$;

insert into auth.users(
  id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select id,'authenticated','authenticated',email,now(),
  jsonb_build_object('identity_type','condominium_owner','onboarding_attempt_id',attempt_id::text),
  jsonb_build_object('rol_pretendido','propietario'),now(),now()
from (values
  ('ffffffff-ffff-4fff-8fff-ffffffffff01'::uuid,'cleanup-clean@example.invalid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01'::uuid),
  ('ffffffff-ffff-4fff-8fff-ffffffffff02'::uuid,'cleanup-existing@example.invalid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02'::uuid),
  ('ffffffff-ffff-4fff-8fff-ffffffffff03'::uuid,'cleanup-internal@example.invalid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03'::uuid),
  ('ffffffff-ffff-4fff-8fff-ffffffffff04'::uuid,'cleanup-partner@example.invalid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04'::uuid),
  ('ffffffff-ffff-4fff-8fff-ffffffffff05'::uuid,'cleanup-membership@example.invalid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05'::uuid),
  ('ffffffff-ffff-4fff-8fff-ffffffffff06'::uuid,'cleanup-access@example.invalid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee06'::uuid),
  ('ffffffff-ffff-4fff-8fff-ffffffffff07'::uuid,'cleanup-used@example.invalid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee07'::uuid),
  ('ffffffff-ffff-4fff-8fff-ffffffffff08'::uuid,'cleanup-fk@example.invalid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee08'::uuid),
  ('ffffffff-ffff-4fff-8fff-ffffffffff09'::uuid,'cleanup-legacy@example.invalid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee09'::uuid),
  ('ffffffff-ffff-4fff-8fff-ffffffffff10'::uuid,'cleanup-no-profile-access@example.invalid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10'::uuid),
  ('ffffffff-ffff-4fff-8fff-ffffffffff11'::uuid,'cleanup-success@example.invalid','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11'::uuid)
) as fixture(id,email,attempt_id);

do $$
begin
  if (select count(*) from public.profiles where id::text like 'ffffffff-ffff-4fff-8fff-ffffffffff__')<>11 then
    raise exception 'TEST: trigger Auth no creó los 11 perfiles sintéticos';
  end if;
  if exists(
    select 1 from public.profiles p
    join public.roles r on r.id=p.role_id
    where p.id::text like 'ffffffff-ffff-4fff-8fff-ffffffffff__'
      and (p.role_id<>'propietario' or p.active is distinct from true or r.es_externo is distinct from true)
  ) then
    raise exception 'TEST: trigger Auth no produjo propietario externo activo';
  end if;
end $$;

-- Falla posterior a Auth/perfil: cleanup completo; una segunda llamada es idempotente.
do $$
declare v jsonb; operator_id uuid;
begin
  select s.operator_id into operator_id from cleanup_test_scope s;
  v:=public.cleanup_condominium_owner_onboarding_profile(
    'ffffffff-ffff-4fff-8fff-ffffffffff01','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',operator_id,'RELATION_WRITE_FAILED'
  );
  if v->>'result_code'<>'PROFILE_DELETED' then raise exception 'TEST: cleanup limpio falló: %',v; end if;
  if exists(select 1 from public.profiles where id='ffffffff-ffff-4fff-8fff-ffffffffff01') then
    raise exception 'TEST: perfil temporal no fue eliminado';
  end if;
  delete from auth.users where id='ffffffff-ffff-4fff-8fff-ffffffffff01';
  v:=public.cleanup_condominium_owner_onboarding_profile(
    'ffffffff-ffff-4fff-8fff-ffffffffff01','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',operator_id,'RETRY_CLEANUP'
  );
  if v->>'result_code'<>'ALREADY_COMPLETE' then raise exception 'TEST: cleanup duplicado no fue idempotente: %',v; end if;
end $$;

-- Reintento posterior: el trigger vuelve a crear perfil propietario y la relación puede completarse.
insert into auth.users(
  id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values(
  'ffffffff-ffff-4fff-8fff-ffffffffff01','authenticated','authenticated','cleanup-clean@example.invalid',now(),
  '{"identity_type":"condominium_owner","onboarding_attempt_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee12"}'::jsonb,
  '{"rol_pretendido":"propietario"}'::jsonb,now(),now()
);
insert into public.condominium_unit_portal_access(
  condominio_id,unidad_id,email_normalized,access_kind,active,created_by,notes
)
select condominio_id,unidad_id,'cleanup-clean@example.invalid','OWNER',true,operator_id,'QA_RETRY'
from cleanup_test_scope;

-- Una identidad preexistente/ambigua nunca se elimina.
do $$
declare v jsonb; operator_id uuid;
begin
  select s.operator_id into operator_id from cleanup_test_scope s;
  v:=public.cleanup_condominium_owner_onboarding_profile(
    'ffffffff-ffff-4fff-8fff-ffffffffff02','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee99',operator_id,'RELATION_WRITE_FAILED'
  );
  if v->>'reason_code'<>'ONBOARDING_MARKER_MISMATCH' then raise exception 'TEST: identidad preexistente no quedó bloqueada: %',v; end if;
end $$;

update public.profiles set role_id='admin' where id='ffffffff-ffff-4fff-8fff-ffffffffff03';
insert into public.partner_users(auth_user_id,active) values('ffffffff-ffff-4fff-8fff-ffffffffff04',true);
insert into public.condominium_access_memberships(
  condominio_id,principal_user_id,access_role,can_view_units,active
)
select condominio_id,'ffffffff-ffff-4fff-8fff-ffffffffff05','transition_viewer',true,true from cleanup_test_scope;
insert into public.condominium_unit_portal_access(
  condominio_id,unidad_id,email_normalized,access_kind,active,created_by,notes
)
select condominio_id,unidad_id,'cleanup-access@example.invalid','OWNER',true,operator_id,'QA_BLOCK'
from cleanup_test_scope;
update auth.users set last_sign_in_at=now() where id='ffffffff-ffff-4fff-8fff-ffffffffff07';
insert into public.clientes(nombre,correo,asesor_id)
values('QA cleanup FK','cleanup-fk-client@example.invalid','ffffffff-ffff-4fff-8fff-ffffffffff08');
update public.unidades_condominio set propietario_email='cleanup-legacy@example.invalid'
where id=(select legacy_unit_id from cleanup_test_scope);
delete from public.profiles where id='ffffffff-ffff-4fff-8fff-ffffffffff10';
insert into public.partner_users(auth_user_id,active) values('ffffffff-ffff-4fff-8fff-ffffffffff10',true);

do $$
declare
  operator_id uuid;
  v jsonb;
begin
  select s.operator_id into operator_id from cleanup_test_scope s;

  v:=public.cleanup_condominium_owner_onboarding_profile('ffffffff-ffff-4fff-8fff-ffffffffff03','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03',operator_id,'QA');
  if v->>'reason_code'<>'PROFILE_NOT_EXTERNAL_OWNER' then raise exception 'TEST: perfil interno no bloqueado: %',v; end if;

  v:=public.cleanup_condominium_owner_onboarding_profile('ffffffff-ffff-4fff-8fff-ffffffffff04','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04',operator_id,'QA');
  if v->>'reason_code'<>'PARTNER_ACCESS_PRESENT' then raise exception 'TEST: partner_user no bloqueado: %',v; end if;

  v:=public.cleanup_condominium_owner_onboarding_profile('ffffffff-ffff-4fff-8fff-ffffffffff05','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05',operator_id,'QA');
  if v->>'reason_code'<>'MEMBERSHIP_PRESENT' then raise exception 'TEST: membresía no bloqueada: %',v; end if;

  v:=public.cleanup_condominium_owner_onboarding_profile('ffffffff-ffff-4fff-8fff-ffffffffff06','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee06',operator_id,'QA');
  if v->>'reason_code'<>'PORTAL_ACCESS_PRESENT' then raise exception 'TEST: relación portal no bloqueada: %',v; end if;

  v:=public.cleanup_condominium_owner_onboarding_profile('ffffffff-ffff-4fff-8fff-ffffffffff07','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee07',operator_id,'QA');
  if v->>'reason_code'<>'IDENTITY_ALREADY_USED' then raise exception 'TEST: actividad previa no bloqueada: %',v; end if;

  v:=public.cleanup_condominium_owner_onboarding_profile('ffffffff-ffff-4fff-8fff-ffffffffff09','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee09',operator_id,'QA');
  if v->>'reason_code'<>'LEGACY_ACCESS_PRESENT' then raise exception 'TEST: acceso legacy no bloqueado: %',v; end if;

  v:=public.cleanup_condominium_owner_onboarding_profile('ffffffff-ffff-4fff-8fff-ffffffffff10','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10',operator_id,'QA');
  if v->>'reason_code'<>'PARTNER_ACCESS_PRESENT' then raise exception 'TEST: acceso con perfil ausente no bloqueado: %',v; end if;

  begin
    perform public.cleanup_condominium_owner_onboarding_profile(
      'ffffffff-ffff-4fff-8fff-ffffffffff08','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee08',operator_id,'QA_FK_FAILURE'
    );
    raise exception 'TEST: se esperaba rechazo por referencia activa';
  exception when foreign_key_violation then
    null;
  end;
  if not exists(select 1 from public.profiles where id='ffffffff-ffff-4fff-8fff-ffffffffff08') then
    raise exception 'TEST: fallo parcial eliminó el perfil';
  end if;
  if exists(select 1 from public.condominium_unit_portal_access where email_normalized='cleanup-fk@example.invalid') then
    raise exception 'TEST: fallo parcial concedió acceso';
  end if;
end $$;

-- Alta correcta: no se llama cleanup y el acceso explícito permanece durante la transacción.
insert into public.condominium_unit_portal_access(
  condominio_id,unidad_id,email_normalized,access_kind,active,created_by,notes
)
select condominio_id,unidad_id,'cleanup-success@example.invalid','COOWNER',true,operator_id,'QA_SUCCESS'
from cleanup_test_scope;

do $$
begin
  if (select count(*) from public.condominium_unit_portal_access where email_normalized in (
    'cleanup-clean@example.invalid','cleanup-success@example.invalid'
  ))<>2 then
    raise exception 'TEST: alta/reintento no completaron las relaciones explícitas';
  end if;
  if exists(
    select 1 from public.condominium_owner_onboarding_cleanup_audit
    where auth_user_id='ffffffff-ffff-4fff-8fff-ffffffffff11'
  ) then
    raise exception 'TEST: alta correcta ejecutó cleanup';
  end if;
end $$;

select jsonb_build_object(
  'status','OWNER_ONBOARDING_CLEANUP_FUNCTIONAL_OK',
  'trigger_profiles',11,
  'cleanup_complete',true,
  'retry_complete',true,
  'blocked_cases',8,
  'persistent_writes',0
) as result;

rollback;
