-- Checks de sólo lectura para el portal condómino MVP.
begin transaction read only;

do $$
begin
  if to_regclass('public.condominium_unit_portal_access') is null then
    raise exception 'CHECK: falta tabla de accesos del portal';
  end if;
  if to_regprocedure('public.condominium_owner_portal_units()') is null
     or to_regprocedure('public.condominium_owner_portal_snapshot(uuid)') is null
     or to_regprocedure('public.condominium_is_controlled(uuid)') is null then
    raise exception 'CHECK: faltan funciones del portal MVP';
  end if;
  if exists(
    select 1 from pg_class
    where oid='public.condominium_unit_portal_access'::regclass and not relrowsecurity
  ) then raise exception 'CHECK: RLS deshabilitado'; end if;
  if exists(
    select 1 from information_schema.role_table_grants
    where table_schema='public'
      and table_name='condominium_unit_portal_access'
      and grantee='anon'
  ) then raise exception 'CHECK: anon conserva privilegios'; end if;
  if has_function_privilege('anon','public.condominium_owner_portal_units()','execute')
     or has_function_privilege('anon','public.condominium_owner_portal_snapshot(uuid)','execute')
     or has_function_privilege('anon','public.condominium_is_controlled(uuid)','execute') then
    raise exception 'CHECK: anon puede ejecutar RPC del portal';
  end if;
  if to_regclass('public.condominium_owner_documents') is not null
     or to_regprocedure('public.condominium_owner_attach_fee_proof(uuid,text)') is not null
     or to_regprocedure('public.condominium_owner_storage_path(text,uuid)') is not null then
    raise exception 'CHECK: el MVP conserva superficies pospuestas';
  end if;
  if not exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='cuotas_condominio'
      and policyname='cuotas_hardened_update'
      and coalesce(qual,'') like '%NOT condominium_is_controlled(condominio_id)%'
      and coalesce(with_check,'') like '%NOT condominium_is_controlled(condominio_id)%'
  ) then raise exception 'CHECK: cuotas controladas conservan UPDATE de propietario'; end if;
  if not exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='gastos_condominio'
      and policyname='gastos_hardened_select'
      and coalesce(qual,'') like '%NOT condominium_is_controlled(condominio_id)%'
  ) then raise exception 'CHECK: gastos controlados permanecen visibles'; end if;
  if not exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='maintenance_tickets'
      and policyname='maintenance_hardened_select'
      and coalesce(qual,'') like '%NOT condominium_is_controlled(condominio_id)%'
  ) then raise exception 'CHECK: mantenimiento controlado permanece visible'; end if;
end $$;

select 'CONDOMINIUM_OWNER_PORTAL_MVP_CHECKS_OK' as result;
rollback;
