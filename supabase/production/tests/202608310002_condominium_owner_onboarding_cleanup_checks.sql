begin transaction read only;

do $$
begin
  if to_regprocedure('public.cleanup_condominium_owner_onboarding_profile(uuid,uuid,uuid,text)') is null then
    raise exception 'Falta función de cleanup condominal.';
  end if;
  if not has_function_privilege('service_role','public.cleanup_condominium_owner_onboarding_profile(uuid,uuid,uuid,text)','EXECUTE') then
    raise exception 'service_role no puede ejecutar cleanup.';
  end if;
  if has_function_privilege('anon','public.cleanup_condominium_owner_onboarding_profile(uuid,uuid,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.cleanup_condominium_owner_onboarding_profile(uuid,uuid,uuid,text)','EXECUTE') then
    raise exception 'Cleanup expuesto a cliente.';
  end if;
  if has_table_privilege('anon','public.profiles','DELETE')
     or has_table_privilege('authenticated','public.profiles','DELETE')
     or has_table_privilege('service_role','public.profiles','DELETE') then
    raise exception 'Se concedió DELETE general sobre profiles.';
  end if;
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='cleanup_condominium_owner_onboarding_profile'
      and p.prosecdef=true
      and pg_get_userbyid(p.proowner)='postgres'
      and p.proconfig @> array['search_path=public, pg_temp']::text[]
  ) then
    raise exception 'Cleanup no conserva owner/search_path endurecidos.';
  end if;
  if has_table_privilege('anon','public.profiles','INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated','public.profiles','INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'El onboarding debilitó el hardening P0 de profiles.';
  end if;
end $$;

select jsonb_build_object('status','OWNER_ONBOARDING_CLEANUP_OK','writes',0) as result;
rollback;
