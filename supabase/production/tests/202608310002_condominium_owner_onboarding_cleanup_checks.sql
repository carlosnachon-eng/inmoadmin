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
end $$;

select jsonb_build_object('status','OWNER_ONBOARDING_CLEANUP_OK','writes',0) as result;
rollback;
