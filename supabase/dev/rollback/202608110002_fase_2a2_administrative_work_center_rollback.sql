-- DEV ONLY - Fase 2A.2-0C - rollback completo y conservador.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- NUNCA ejecutar en Produccion.
-- No usa DROP CASCADE y aborta si alguna tabla 2A.2 contiene filas no QA.

begin;

do $$
begin
  if exists (select 1 from public.payments where id <> '2a220000-0000-4000-8000-000000000020') then
    raise exception 'Rollback 2A.2 abortado: payments contiene filas no QA';
  end if;
  if exists (select 1 from public.contracts where id not in (
    '2a220000-0000-4000-8000-000000000010',
    '2a220000-0000-4000-8000-000000000011'
  )) then raise exception 'Rollback 2A.2 abortado: contracts contiene filas no QA'; end if;
  if exists (select 1 from public.maintenance_tickets where id not in (
    '2a220000-0000-4000-8000-000000000030',
    '2a220000-0000-4000-8000-000000000031'
  )) then raise exception 'Rollback 2A.2 abortado: maintenance_tickets contiene filas no QA'; end if;
  if exists (select 1 from public.maintenance_quotes where id <> '2a220000-0000-4000-8000-000000000040') then
    raise exception 'Rollback 2A.2 abortado: maintenance_quotes contiene filas no QA';
  end if;
  if exists (select 1 from public.firmas where id <> '2a220000-0000-4000-8000-000000000050') then
    raise exception 'Rollback 2A.2 abortado: firmas contiene filas no QA';
  end if;
  if exists (select 1 from public.firma_etapas where id <> '2a220000-0000-4000-8000-000000000051') then
    raise exception 'Rollback 2A.2 abortado: firma_etapas contiene filas no QA';
  end if;
  if exists (select 1 from public.firmas_citas where id <> '2a220000-0000-4000-8000-000000000052') then
    raise exception 'Rollback 2A.2 abortado: firmas_citas contiene filas no QA';
  end if;
  if exists (select 1 from public.inspecciones where id not in (
    '2a220000-0000-4000-8000-000000000060',
    '2a220000-0000-4000-8000-000000000061'
  )) then raise exception 'Rollback 2A.2 abortado: inspecciones contiene filas no QA'; end if;
  if exists (select 1 from public.solicitudes_inquilino where id <> '2a220000-0000-4000-8000-000000000070') then
    raise exception 'Rollback 2A.2 abortado: solicitudes_inquilino contiene filas no QA';
  end if;
  if exists (select 1 from public.poliza_expedientes where id <> '2a220000-0000-4000-8000-000000000080') then
    raise exception 'Rollback 2A.2 abortado: poliza_expedientes contiene filas no QA';
  end if;
  if exists (select 1 from public.properties where id <> '2a220000-0000-4000-8000-000000000001') then
    raise exception 'Rollback 2A.2 abortado: properties contiene filas no QA';
  end if;
  if exists (select 1 from public.plantillas_inspeccion where id <> '2a220000-0000-4000-8000-000000000002') then
    raise exception 'Rollback 2A.2 abortado: plantillas_inspeccion contiene filas no QA';
  end if;
  if exists (select 1 from public.users) then
    raise exception 'Rollback 2A.2 abortado: public.users contiene filas';
  end if;
  if exists (select 1 from public.condominios) then
    raise exception 'Rollback 2A.2 abortado: condominios contiene filas';
  end if;
  if exists (select 1 from public.propietarios_inmuebles) then
    raise exception 'Rollback 2A.2 abortado: propietarios_inmuebles contiene filas';
  end if;
end;
$$;

delete from public.poliza_expedientes
where id = '2a220000-0000-4000-8000-000000000080';
delete from public.solicitudes_inquilino
where id = '2a220000-0000-4000-8000-000000000070';
delete from public.inspecciones
where id in (
  '2a220000-0000-4000-8000-000000000060',
  '2a220000-0000-4000-8000-000000000061'
);
delete from public.firmas_citas
where id = '2a220000-0000-4000-8000-000000000052';
delete from public.firma_etapas
where id = '2a220000-0000-4000-8000-000000000051';
delete from public.firmas
where id = '2a220000-0000-4000-8000-000000000050';
delete from public.maintenance_quotes
where id = '2a220000-0000-4000-8000-000000000040';
delete from public.maintenance_tickets
where id in (
  '2a220000-0000-4000-8000-000000000030',
  '2a220000-0000-4000-8000-000000000031'
);
delete from public.payments
where id = '2a220000-0000-4000-8000-000000000020';
delete from public.contracts
where id in (
  '2a220000-0000-4000-8000-000000000010',
  '2a220000-0000-4000-8000-000000000011'
);
delete from public.plantillas_inspeccion
where id = '2a220000-0000-4000-8000-000000000002';
delete from public.properties
where id = '2a220000-0000-4000-8000-000000000001';

delete from public.permisos_modulo
where id in (
  '2a220000-0000-4000-8000-000000000090',
  '2a220000-0000-4000-8000-000000000091'
);

drop table if exists public.poliza_expedientes;
drop table if exists public.solicitudes_inquilino;
drop table if exists public.inspecciones;
drop table if exists public.firmas_citas;
drop table if exists public.firma_etapas;
drop table if exists public.firmas;
drop table if exists public.maintenance_quotes;
drop table if exists public.maintenance_tickets;
drop table if exists public.payments;
drop table if exists public.contracts;
drop table if exists public.plantillas_inspeccion;
drop table if exists public.properties;
drop table if exists public.propietarios_inmuebles;
drop table if exists public.condominios;
drop table if exists public.users;

drop function if exists public.current_profile_can_view_operations_work_center();
drop function if exists public.dev_2a2_set_updated_at();

do $$
begin
  if to_regclass('public.firmas_pre_2a2') is null
     or to_regclass('public.firma_etapas_pre_2a2') is null
     or to_regclass('public.firmas_citas_pre_2a2') is null then
    raise exception 'Rollback 2A.2: faltan tablas legacy *_pre_2a2';
  end if;

  alter table public.firmas_pre_2a2 rename to firmas;
  alter table public.firma_etapas_pre_2a2 rename to firma_etapas;
  alter table public.firmas_citas_pre_2a2 rename to firmas_citas;

  alter index if exists public.firmas_pre_2a2_pkey rename to firmas_pkey;
  alter index if exists public.firma_etapas_pre_2a2_pkey rename to firma_etapas_pkey;
  alter index if exists public.firmas_citas_pre_2a2_pkey rename to firmas_citas_pkey;
end;
$$;

commit;
