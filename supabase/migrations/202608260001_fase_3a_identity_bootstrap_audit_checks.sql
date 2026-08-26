do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.respond_identity_audit'::regclass
      and conname = 'respond_identity_audit_event_type_check'
      and pg_get_constraintdef(oid) like '%bootstrap_evaluated%'
  ) then raise exception 'bootstrap_evaluated audit event missing'; end if;
  if has_table_privilege('anon','public.respond_identity_audit','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.respond_identity_audit','SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'client roles must not access identity audit';
  end if;
  if not has_table_privilege('service_role','public.respond_identity_audit','SELECT,INSERT')
     or has_table_privilege('service_role','public.respond_identity_audit','UPDATE,DELETE,TRUNCATE') then
    raise exception 'identity audit service_role grants must remain append-only';
  end if;
end $$;
