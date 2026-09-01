-- Contrato del trigger Auth con fixtures sintéticos y rollback total.
begin;
set local statement_timeout='60s';

-- DEV minimal no contiene todavía todos los roles legacy productivos. Se crean
-- sólo dentro de esta transacción para validar el contrato y se revierten.
insert into public.roles(id,nombre,descripcion,es_externo)
values
  ('inquilino','Inquilino','QA temporal P0',true),
  ('condomino','Condómino','QA temporal P0',true)
on conflict(id) do nothing;

insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
values
  ('92000000-0000-4000-8000-000000000001','qa-p0-owner@example.invalid','{"rol_pretendido":"propietario"}'::jsonb,'{}'::jsonb,now(),now()),
  ('92000000-0000-4000-8000-000000000002','qa-p0-tenant@example.invalid','{"rol_pretendido":"inquilino"}'::jsonb,'{}'::jsonb,now(),now()),
  ('92000000-0000-4000-8000-000000000003','qa-p0-condomino@example.invalid','{"rol_pretendido":"condomino"}'::jsonb,'{}'::jsonb,now(),now()),
  ('92000000-0000-4000-8000-000000000004','qa-p0-internal@example.invalid','{}'::jsonb,'{}'::jsonb,now(),now());

do $$
begin
  if (select count(*) from public.profiles where id::text like '92000000-0000-4000-8000-%')<>4 then
    raise exception 'AUTH TRIGGER: no creó exactamente cuatro perfiles';
  end if;
  if (select role_id from public.profiles where id='92000000-0000-4000-8000-000000000001')<>'propietario' then raise exception 'AUTH TRIGGER: propietario incorrecto'; end if;
  if (select role_id from public.profiles where id='92000000-0000-4000-8000-000000000002')<>'inquilino' then raise exception 'AUTH TRIGGER: inquilino incorrecto'; end if;
  if (select role_id from public.profiles where id='92000000-0000-4000-8000-000000000003')<>'condomino' then raise exception 'AUTH TRIGGER: condomino incorrecto'; end if;
  if (select role_id from public.profiles where id='92000000-0000-4000-8000-000000000004')<>'asesor' then raise exception 'AUTH TRIGGER: interno legacy no cayó en asesor'; end if;
  begin
    insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
    values('92000000-0000-4000-8000-000000000099','qa-p0-invalid@example.invalid','{"rol_pretendido":"admin"}'::jsonb,'{}'::jsonb,now(),now());
    raise exception 'AUTH TRIGGER: rol privilegiado inesperado fue aceptado';
  exception
    when sqlstate '22023' then null;
  end;

  if exists(select 1 from public.profiles where id='92000000-0000-4000-8000-000000000099') then
    raise exception 'AUTH TRIGGER: rol rechazado dejó perfil parcial';
  end if;

  begin
    insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
    values('92000000-0000-4000-8000-000000000098','qa-p0-antive-direct@example.invalid','{"rol_pretendido":"antive_transition"}'::jsonb,'{"identity_type":"antive_transition"}'::jsonb,now(),now());
    raise exception 'AUTH TRIGGER: rol externo privilegiado fue aceptado desde metadata';
  exception
    when sqlstate '22023' then null;
  end;
end $$;

select 'PROFILES_HARDENING_P0_AUTH_TRIGGER_TESTS_OK' as result;
rollback;
