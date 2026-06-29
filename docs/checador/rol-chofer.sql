-- Rol operativo para Chofer en InmoAdmin.
-- Objetivo:
-- - Puede entrar al módulo Checador.
-- - Puede registrar entrada/salida desde ubicación distinta a oficina.
-- - Puede tomar/devolver llaves como personal interno.
-- - No entra a KPIs comerciales.
-- - No tiene vista Admin del Checador.

insert into public.roles (id, nombre, descripcion, es_externo)
select
  'chofer',
  'Chofer',
  'Rol operativo para chofer: checador, llaves y control futuro de vehículos.',
  false
where not exists (
  select 1 from public.roles where id = 'chofer'
);

update public.roles
set
  nombre = 'Chofer',
  descripcion = 'Rol operativo para chofer: checador, llaves y control futuro de vehículos.',
  es_externo = false
where id = 'chofer';

insert into public.permisos_modulo (role_id, modulo, puede_ver, puede_editar, alcance)
select
  'chofer',
  'checador',
  true,
  true,
  'propio'
where not exists (
  select 1
  from public.permisos_modulo
  where role_id = 'chofer'
    and modulo = 'checador'
);

update public.permisos_modulo
set
  puede_ver = true,
  puede_editar = true,
  alcance = 'propio'
where role_id = 'chofer'
  and modulo = 'checador';

-- Asignar el rol al nuevo chofer:
update public.profiles
set
  role_id = 'chofer',
  full_name = coalesce(nullif(full_name, ''), 'Ismael Ortiz'),
  active = true
where lower(email) = lower('ismaelorortiz@gmail.com');
