-- Read-only, fail-closed preactivation gate. Run before issuing invitations.
DO $$
DECLARE
  actual text[];
  table_oid oid := 'public.blindaje_partner_invitations'::regclass;
  rpc_oid oid := 'public.blindaje_link_invited_submission(text,text,uuid)'::regprocedure;
BEGIN
  SELECT array_agg(privilege_type::text ORDER BY privilege_type) INTO actual
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'blindaje_partner_invitations'
    AND grantee = 'service_role';
  IF actual IS DISTINCT FROM ARRAY['DELETE','INSERT','SELECT','UPDATE']::text[] THEN
    RAISE EXCEPTION 'Unexpected service_role table privileges: %', actual;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a
    WHERE c.oid = table_oid AND a.grantee IN
      (0, (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
          (SELECT oid FROM pg_roles WHERE rolname = 'authenticated'))
  ) OR has_table_privilege('anon', table_oid, 'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,TRUNCATE')
    OR has_table_privilege('authenticated', table_oid, 'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,TRUNCATE') THEN
    RAISE EXCEPTION 'Public table access detected';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = table_oid)
    OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = table_oid) THEN
    RAISE EXCEPTION 'Unexpected RLS/policies';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = rpc_oid)
    OR NOT has_function_privilege('service_role', rpc_oid, 'EXECUTE')
    OR has_function_privilege('anon', rpc_oid, 'EXECUTE')
    OR has_function_privilege('authenticated', rpc_oid, 'EXECUTE')
    OR EXISTS (
      SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
      WHERE p.oid = rpc_oid AND a.privilege_type = 'EXECUTE'
        AND a.grantee NOT IN (p.proowner, (SELECT oid FROM pg_roles WHERE rolname = 'service_role'))
    ) THEN
    RAISE EXCEPTION 'Unexpected RPC permissions or security mode';
  END IF;
END $$;
SELECT 'PASS: exact CRUD; no public grants; RLS on; no policies; RPC invoker/server-only' AS result,
  (SELECT count(*) FROM public.blindaje_partner_invitations) AS invitation_count;
