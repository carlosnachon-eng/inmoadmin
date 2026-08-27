-- Checks de sólo lectura. No contienen datos ni crean usuarios.
begin transaction read only;

do $$
begin
  if to_regclass('public.condominium_unit_portal_access') is null
     or to_regclass('public.condominium_owner_documents') is null then
    raise exception 'CHECK: faltan tablas del portal';
  end if;
  if to_regprocedure('public.condominium_owner_portal_units()') is null
     or to_regprocedure('public.condominium_owner_portal_snapshot(uuid)') is null
     or to_regprocedure('public.condominium_owner_attach_fee_proof(uuid,text)') is null
     or to_regprocedure('public.condominium_owner_storage_path(text,uuid)') is null then
    raise exception 'CHECK: faltan funciones del portal';
  end if;
  if exists(
    select 1 from pg_class where oid in (
      'public.condominium_unit_portal_access'::regclass,
      'public.condominium_owner_documents'::regclass
    ) and not relrowsecurity
  ) then raise exception 'CHECK: RLS deshabilitado'; end if;
  if exists(
    select 1 from information_schema.role_table_grants
    where table_schema='public'
      and table_name in ('condominium_unit_portal_access','condominium_owner_documents')
      and grantee='anon'
  ) then raise exception 'CHECK: anon conserva privilegios'; end if;
  if not exists(
    select 1 from storage.buckets
    where id='condominium-owner-private' and public=false and file_size_limit=10485760
  ) then raise exception 'CHECK: bucket privado incorrecto'; end if;
end $$;

select 'CONDOMINIUM_OWNER_PORTAL_CHECKS_OK' as result;
rollback;
