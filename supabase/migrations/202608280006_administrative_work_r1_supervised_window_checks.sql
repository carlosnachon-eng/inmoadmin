do $$ begin
  if has_function_privilege('service_role','public.execute_administrative_work_r1(text,jsonb,text,text,uuid)','EXECUTE') then
    raise exception 'legacy R1 RPC must not remain callable by service_role';
  end if;
  if has_function_privilege('anon','public.execute_administrative_work_r1_supervised(text,jsonb,text,text,uuid,timestamptz,timestamptz,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.execute_administrative_work_r1_supervised(text,jsonb,text,text,uuid,timestamptz,timestamptz,integer)','EXECUTE')
    or not has_function_privilege('service_role','public.execute_administrative_work_r1_supervised(text,jsonb,text,text,uuid,timestamptz,timestamptz,integer)','EXECUTE') then
    raise exception 'supervised R1 RPC privilege boundary invalid';
  end if;
  if has_table_privilege('service_role','public.administrative_work_history','UPDATE')
    or has_table_privilege('service_role','public.administrative_work_history','DELETE') then
    raise exception 'history must remain append-only';
  end if;
end $$;
