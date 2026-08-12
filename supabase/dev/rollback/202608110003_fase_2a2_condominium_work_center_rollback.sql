-- DEV ONLY - Fase 2A.2-A - rollback del complemento de Condominios.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- NUNCA ejecutar en Produccion.
-- No usa DROP CASCADE y aborta si las tablas nuevas contienen filas no QA.

begin;

do $$
begin
  if exists (
    select 1 from public.cuotas_condominio
    where id::text not like '2a223000-0000-4000-8000-%'
  ) then
    raise exception 'Rollback 2A.2 Condominios abortado: cuotas_condominio contiene filas no QA';
  end if;
  if exists (
    select 1 from public.unidades_condominio
    where id::text not like '2a223000-0000-4000-8000-%'
  ) then
    raise exception 'Rollback 2A.2 Condominios abortado: unidades_condominio contiene filas no QA';
  end if;
end;
$$;

delete from public.cuotas_condominio
where id::text like '2a223000-0000-4000-8000-%';

delete from public.unidades_condominio
where id::text like '2a223000-0000-4000-8000-%';

delete from public.condominios
where id::text like '2a223000-0000-4000-8000-%';

drop table if exists public.cuotas_condominio;
drop table if exists public.unidades_condominio;

commit;
