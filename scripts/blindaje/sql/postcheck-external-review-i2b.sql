do $$
declare t oid := 'public.blindaje_investigation_ledger_entries'::regclass; f regprocedure; privileges text[];
begin
  assert (select relrowsecurity from pg_class where oid=t), 'ledger RLS required';
  assert not exists(select 1 from pg_policy where polrelid=t), 'ledger policies must be empty';
  select array_agg(privilege_type order by privilege_type) into privileges from information_schema.role_table_grants where table_schema='public' and table_name='blindaje_investigation_ledger_entries' and grantee='service_role';
  assert privileges = array['INSERT','SELECT'], 'exact ledger service privileges required';
  assert not exists(select 1 from aclexplode((select relacl from pg_class where oid=t)) a where grantee=0), 'PUBLIC grants forbidden';
  assert not has_table_privilege('anon',t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'anon grants forbidden';
  assert not has_table_privilege('authenticated',t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'authenticated grants forbidden';
  foreach f in array array['public.blindaje_review_investigation_payment(uuid,text,uuid,text,text)'::regprocedure,'public.blindaje_bootstrap_external_payment(text,text,text,text)'::regprocedure,'public.blindaje_receive_payment_proof(text,text,text,text,text,text,text)'::regprocedure] loop
    assert not (select prosecdef from pg_proc where oid=f), 'RPC must be INVOKER';
    assert (select proconfig @> array['search_path=""'] from pg_proc where oid=f), 'RPC empty search_path required';
    assert has_function_privilege('service_role',f,'EXECUTE'), 'service execute required';
    assert not has_function_privilege('anon',f,'EXECUTE'), 'anon execute forbidden';
    assert not has_function_privilege('authenticated',f,'EXECUTE'), 'authenticated execute forbidden';
    assert not exists(select 1 from aclexplode((select proacl from pg_proc where oid=f)) where grantee=0), 'PUBLIC execute forbidden';
  end loop;
  assert (select count(*)=2 from information_schema.columns where table_schema='public' and table_name='blindaje_investigation_payments' and column_name in ('rejected_by','rejected_at')), 'audit columns required';
end $$;
select 'I2B exact privileges PASS' result;
