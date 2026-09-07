do $$
declare v_def text;
begin
  if to_regprocedure('public.confirm_exact_phone_respond_identity_link(uuid,text,text,timestamp with time zone,text,text,uuid)') is null then raise exception 'confirmation function missing'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='respond_identity_audit_exact_phone_evidence_uidx') then raise exception 'evidence idempotency index missing'; end if;
  if has_function_privilege('anon','public.confirm_exact_phone_respond_identity_link(uuid,text,text,timestamp with time zone,text,text,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.confirm_exact_phone_respond_identity_link(uuid,text,text,timestamp with time zone,text,text,uuid)','EXECUTE') then raise exception 'confirmation function exposed'; end if;
  if not has_function_privilege('service_role','public.confirm_exact_phone_respond_identity_link(uuid,text,text,timestamp with time zone,text,text,uuid)','EXECUTE') then raise exception 'service role cannot confirm'; end if;
  select pg_get_functiondef('public.confirm_exact_phone_respond_identity_link(uuid,text,text,timestamp with time zone,text,text,uuid)'::regprocedure) into v_def;
  if v_def !~ 'for update' or v_def !~ 'exact_phone_unique_v1' or v_def !~ 'respond_contact_not_unique' or v_def !~ 'ambiguous_property_context' or v_def !~ 'ambiguous_role_context' or v_def !~ 'on conflict do nothing' then raise exception 'fail-closed confirmation guards incomplete'; end if;
  if has_table_privilege('service_role','public.respond_identity_audit','UPDATE,DELETE,TRUNCATE') then raise exception 'audit must remain append-only'; end if;
end $$;
select 'PASS 202609070001 exact phone identity confirmation' as result;
