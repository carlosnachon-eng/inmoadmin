-- DEV ONLY - rollback del bootstrap 202608180002.
-- Destructivo: elimina las siete tablas y cualquier dato DEV que contengan.
-- NUNCA ejecutar en Produccion.

begin;

do $$
declare
  table_name text;
  target_tables constant text[] := array[
    'servicios_inmueble', 'pagos_servicios', 'owner_payments',
    'owner_payment_receipts', 'property_expenses', 'comisiones_admin', 'llaves'
  ];
begin
  foreach table_name in array target_tables loop
    if to_regclass(format('public.%I', table_name)) is not null
       and coalesce(obj_description(to_regclass(format('public.%I', table_name)), 'pg_class'), '')
         <> 'dev-bootstrap:202608180002:fase-1-operational-sources' then
      raise exception 'Rollback Fase 1 DEV: public.% no pertenece a este bootstrap', table_name;
    end if;
  end loop;
end;
$$;

drop table if exists public.pagos_servicios;
drop table if exists public.owner_payment_receipts;
drop table if exists public.owner_payments;
drop table if exists public.comisiones_admin;
drop table if exists public.llaves;
drop table if exists public.property_expenses;
drop table if exists public.servicios_inmueble;

commit;
