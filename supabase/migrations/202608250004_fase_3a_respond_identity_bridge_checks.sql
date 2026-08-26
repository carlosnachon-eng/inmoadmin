do $$ begin
  if to_regclass('public.respond_identity_links') is null or to_regclass('public.respond_identity_audit') is null then raise exception 'identity bridge tables missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.respond_identity_links'::regclass) then raise exception 'links RLS disabled'; end if;
  if has_table_privilege('anon','public.respond_identity_links','SELECT') or has_table_privilege('authenticated','public.respond_identity_links','SELECT') then raise exception 'client read must remain unavailable'; end if;
  if has_table_privilege('authenticated','public.respond_identity_links','INSERT,UPDATE,DELETE') then raise exception 'authenticated write must remain unavailable'; end if;
  if not has_table_privilege('service_role','public.respond_identity_links','SELECT,INSERT,UPDATE') then raise exception 'service role allowlist incomplete'; end if;
  if has_table_privilege('service_role','public.respond_identity_links','DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'service role overprivileged'; end if;
  if has_table_privilege('service_role','public.respond_identity_audit','UPDATE,DELETE,TRUNCATE') then raise exception 'audit must be append-only'; end if;
  if has_function_privilege('anon','public.find_respond_identity_candidates(text)','EXECUTE') or has_function_privilege('authenticated','public.find_respond_identity_candidates(text)','EXECUTE') then raise exception 'candidate RPC exposed to clients'; end if;
  if not has_function_privilege('service_role','public.find_respond_identity_candidates(text)','EXECUTE') then raise exception 'candidate RPC unavailable server-side'; end if;
end $$;
