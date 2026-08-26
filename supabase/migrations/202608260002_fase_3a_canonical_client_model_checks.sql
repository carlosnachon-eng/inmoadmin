do $$
declare v_table text;
begin
  foreach v_table in array array['client_identities','client_identity_roles','client_source_links','client_reconciliation_candidates','client_reconciliation_candidate_sources','client_identity_audit'] loop
    if to_regclass('public.'||v_table) is null then raise exception 'missing table %',v_table; end if;
    if not (select relrowsecurity from pg_class where oid=('public.'||v_table)::regclass) then raise exception 'RLS disabled %',v_table; end if;
    if has_table_privilege('anon','public.'||v_table,'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated','public.'||v_table,'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'client role access open %',v_table;
    end if;
  end loop;
  if not has_table_privilege('service_role','public.client_identities','SELECT,INSERT,UPDATE')
     or has_table_privilege('service_role','public.client_identities','DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'identity grants invalid'; end if;
  if not has_table_privilege('service_role','public.client_identity_audit','SELECT,INSERT')
     or has_table_privilege('service_role','public.client_identity_audit','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'audit not append-only'; end if;
  if has_function_privilege('anon','public.confirm_client_reconciliation_candidate(uuid,uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.confirm_client_reconciliation_candidate(uuid,uuid,uuid)','EXECUTE') then raise exception 'confirm RPC exposed'; end if;
  if not has_function_privilege('service_role','public.confirm_client_reconciliation_candidate(uuid,uuid,uuid)','EXECUTE') then raise exception 'confirm RPC missing'; end if;
  if exists(select 1 from public.client_identities) then raise exception 'migration must not seed identities'; end if;
  if exists(select 1 from public.client_reconciliation_candidates) then raise exception 'migration must not seed candidates'; end if;
  -- Vínculos legacy se preservan sin reclasificación; sólo los nuevos client_identity_id
  -- serán consumibles por el resolver canónico tras reconciliación explícita.
end $$;
