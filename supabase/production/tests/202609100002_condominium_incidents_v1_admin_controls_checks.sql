do $$ begin
  if to_regprocedure('public.condominium_admin_update_incident_v1(uuid,uuid,text,text,uuid,boolean,text,text,text)') is null then
    raise exception 'INCIDENT_ADMIN_CONTROLS_FUNCTION_MISSING';
  end if;
  if has_function_privilege('anon','public.condominium_admin_update_incident_v1(uuid,uuid,text,text,uuid,boolean,text,text,text)','execute') then
    raise exception 'INCIDENT_ADMIN_CONTROLS_ANON_EXECUTE';
  end if;
  if not has_function_privilege('authenticated','public.condominium_admin_update_incident_v1(uuid,uuid,text,text,uuid,boolean,text,text,text)','execute') then
    raise exception 'INCIDENT_ADMIN_CONTROLS_AUTH_EXECUTE_MISSING';
  end if;
  if has_function_privilege('authenticated','public.condominium_update_incident_v1(uuid,uuid,text,text,uuid,text,text,text)','execute') then
    raise exception 'INCIDENT_ADMIN_CONTROLS_LEGACY_RPC_EXPOSED';
  end if;
end $$;
select 'CONDOMINIUM_INCIDENTS_V1_ADMIN_CONTROLS_POSTCHECK_OK' as result;
