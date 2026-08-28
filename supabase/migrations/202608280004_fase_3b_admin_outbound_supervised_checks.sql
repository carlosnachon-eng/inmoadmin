do $$ begin
  if to_regclass('public.shadow_admin_outbound_messages') is null then raise exception 'outbound audit table missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.shadow_admin_outbound_messages'::regclass) then raise exception 'RLS must be enabled'; end if;
  if has_table_privilege('anon','public.shadow_admin_outbound_messages','SELECT') or has_table_privilege('authenticated','public.shadow_admin_outbound_messages','SELECT') then raise exception 'client access forbidden'; end if;
  if not has_table_privilege('service_role','public.shadow_admin_outbound_messages','SELECT,INSERT,UPDATE') then raise exception 'service_role allowlist missing'; end if;
  if has_table_privilege('service_role','public.shadow_admin_outbound_messages','DELETE') or has_table_privilege('service_role','public.shadow_admin_outbound_messages','TRUNCATE') or has_table_privilege('service_role','public.shadow_admin_outbound_messages','REFERENCES') or has_table_privilege('service_role','public.shadow_admin_outbound_messages','TRIGGER') then raise exception 'destructive privileges forbidden'; end if;
  if to_regprocedure('public.claim_shadow_admin_outbound(text,timestamp with time zone)') is null then raise exception 'cutoff-aware claim missing'; end if;
  if to_regprocedure('public.claim_shadow_admin_outbound(text)') is not null then raise exception 'legacy claim signature must be unavailable'; end if;
  if has_function_privilege('anon','public.claim_shadow_admin_outbound(text,timestamp with time zone)','EXECUTE') or has_function_privilege('authenticated','public.claim_shadow_admin_outbound(text,timestamp with time zone)','EXECUTE') then raise exception 'claim must be server-side'; end if;
  if not has_function_privilege('service_role','public.claim_shadow_admin_outbound(text,timestamp with time zone)','EXECUTE') then raise exception 'service role claim missing'; end if;
  if exists(select 1 from public.shadow_admin_outbound_messages) then raise exception 'migration must not seed outbound'; end if;
end $$;
