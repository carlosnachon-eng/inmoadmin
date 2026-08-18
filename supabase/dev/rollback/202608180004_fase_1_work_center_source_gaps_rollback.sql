-- DEV ONLY - Rollback seguro del bootstrap 202608180004.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- Ejecutar el cleanup del stress seed antes de este rollback.

begin;

do $$
declare
  owner_marker constant text := 'dev-bootstrap:202608180004:fase-1-work-center-source-gaps';
  cash_marker constant text := 'dev-bootstrap:202608180004:fase-1-work-center-source-gaps';
begin
  if to_regclass('public.cash_movements') is not null then
    if coalesce(obj_description('public.cash_movements'::regclass, 'pg_class'), '') <> cash_marker then
      raise exception 'Rollback DEV: cash_movements no pertenece al bootstrap 202608180004';
    end if;
    if exists (select 1 from public.cash_movements limit 1) then
      raise exception 'Rollback DEV: cash_movements contiene datos; limpiar primero el dataset propietario';
    end if;
  end if;

  if exists (
    select 1
    from pg_attribute a
    where a.attrelid = 'public.properties'::regclass
      and a.attname = 'owner_email'
      and a.attnum > 0
      and not a.attisdropped
      and coalesce(col_description(a.attrelid, a.attnum), '') = owner_marker
  ) and exists (select 1 from public.properties where owner_email is not null limit 1) then
    raise exception 'Rollback DEV: properties.owner_email contiene datos; no se eliminará';
  end if;

  if to_regclass('public.cash_movements') is not null then
    drop table public.cash_movements;
  end if;

  if exists (
    select 1
    from pg_attribute a
    where a.attrelid = 'public.properties'::regclass
      and a.attname = 'owner_email'
      and a.attnum > 0
      and not a.attisdropped
      and coalesce(col_description(a.attrelid, a.attnum), '') = owner_marker
  ) then
    alter table public.properties drop column owner_email;
  end if;
end;
$$;

commit;
