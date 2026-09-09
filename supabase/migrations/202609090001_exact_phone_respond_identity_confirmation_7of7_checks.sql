do $$ declare v_def text;
begin
  if to_regprocedure('public.confirm_exact_phone_respond_identity_link(text,uuid,text,text,timestamp with time zone,text,text,uuid)') is null then raise exception 'confirmation function missing'; end if;
  if to_regprocedure('public.confirm_exact_phone_respond_identity_link_core(text,uuid,text,text,timestamp with time zone,text,text,uuid)') is null then raise exception 'confirmation core missing'; end if;
  if to_regprocedure('public.confirm_exact_phone_respond_identity_link(uuid,text,text,timestamp with time zone,text,text,uuid)') is not null then raise exception 'legacy confirmation overload remains'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='respond_identity_links_confirmed_identity_uidx') then raise exception 'confirmed identity uniqueness missing'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='respond_identity_audit_exact_phone_evidence_uidx') then raise exception 'audit idempotency missing'; end if;
  if has_function_privilege('anon','public.confirm_exact_phone_respond_identity_link(text,uuid,text,text,timestamp with time zone,text,text,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.confirm_exact_phone_respond_identity_link(text,uuid,text,text,timestamp with time zone,text,text,uuid)','EXECUTE') then raise exception 'function exposed'; end if;
  if not has_function_privilege('service_role','public.confirm_exact_phone_respond_identity_link(text,uuid,text,text,timestamp with time zone,text,text,uuid)','EXECUTE') then raise exception 'service role missing'; end if;
  if has_function_privilege('service_role','public.confirm_exact_phone_respond_identity_link_core(text,uuid,text,text,timestamp with time zone,text,text,uuid)','EXECUTE') then raise exception 'confirmation core exposed'; end if;
  select pg_get_functiondef('public.confirm_exact_phone_respond_identity_link(text,uuid,text,text,timestamp with time zone,text,text,uuid)'::regprocedure) into v_def;
  v_def := lower(v_def);
  if v_def !~ 'candidate_ref_not_in_certified_cohort'
     or v_def !~ 'p\.active[[:space:]]*(is|=)[[:space:]]*true'
     or v_def !~ 'p\.role_id[[:space:]]*=[[:space:]]*''admin'''
     or v_def !~ 'extensions\.digest' then raise exception 'wrapper guards missing'; end if;
  select lower(pg_get_functiondef('public.confirm_exact_phone_respond_identity_link_core(text,uuid,text,text,timestamp with time zone,text,text,uuid)'::regprocedure)) into v_def;
  if v_def !~ 'p\.active[[:space:]]*(is|=)[[:space:]]*true'
     or v_def !~ 'p\.role_id[[:space:]]*=[[:space:]]*''admin'''
     or v_def !~ 'pg_advisory_xact_lock' or v_def !~ 'extensions\.digest'
     or v_def !~ 'on conflict do nothing' then raise exception 'core guards missing'; end if;
  if has_table_privilege('service_role','public.respond_identity_audit','UPDATE,DELETE,TRUNCATE') then raise exception 'audit not append-only'; end if;
end $$;
select 'PASS 202609090001 exact phone confirmation 7of7' as result;
