do $$
declare definition text;
begin
  if to_regprocedure('public.ingest_shadow_message(jsonb,jsonb)') is null then raise exception 'Falta RPC Shadow'; end if;
  select pg_get_functiondef('public.ingest_shadow_message(jsonb,jsonb)'::regprocedure) into definition;
  if position('360dialog' in definition) = 0 then raise exception 'RPC no admite 360dialog'; end if;
  if has_function_privilege('anon','public.ingest_shadow_message(jsonb,jsonb)','execute') then raise exception 'anon conserva EXECUTE'; end if;
  if has_function_privilege('authenticated','public.ingest_shadow_message(jsonb,jsonb)','execute') then raise exception 'authenticated conserva EXECUTE'; end if;
  if not has_function_privilege('service_role','public.ingest_shadow_message(jsonb,jsonb)','execute') then raise exception 'service_role sin EXECUTE'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename like 'shadow_%' and (qual ~* '^\s*true\s*$' or with_check ~* '^\s*true\s*$')) then raise exception 'Policy Shadow abierta'; end if;
end $$;
