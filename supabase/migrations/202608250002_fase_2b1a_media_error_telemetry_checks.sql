do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_media_retrieval_queue' and column_name='error_stage') then raise exception 'missing error_stage'; end if;
  if to_regprocedure('public.fail_shadow_media_retrieval(uuid,uuid,text,text,timestamptz,text)') is null then raise exception 'missing telemetry fail rpc'; end if;
  if has_function_privilege('anon','public.fail_shadow_media_retrieval(uuid,uuid,text,text,timestamptz,text)','EXECUTE') or has_function_privilege('authenticated','public.fail_shadow_media_retrieval(uuid,uuid,text,text,timestamptz,text)','EXECUTE') then raise exception 'client telemetry rpc access present'; end if;
  if not has_function_privilege('service_role','public.fail_shadow_media_retrieval(uuid,uuid,text,text,timestamptz,text)','EXECUTE') then raise exception 'service role telemetry rpc access missing'; end if;
  if not has_function_privilege('service_role','public.complete_shadow_media_retrieval(uuid,uuid,jsonb)','EXECUTE') then raise exception 'service role complete rpc access missing'; end if;
end $$;
