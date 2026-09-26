do $$
declare name text; privileges text[];
begin
  foreach name in array array['blindaje_external_cases','blindaje_investigation_payments','blindaje_case_access_tokens','blindaje_b2c_submission_tokens'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || name)::regclass) then raise exception 'RLS missing: %',name; end if;
    if exists (select 1 from pg_policies where schemaname='public' and tablename=name) then raise exception 'Unexpected policy: %',name; end if;
    select array_agg(privilege_type order by privilege_type) into privileges from information_schema.role_table_grants where table_schema='public' and table_name=name and grantee='service_role';
    if privileges is distinct from array['INSERT','SELECT','UPDATE'] then raise exception 'Incorrect service grants: % %',name,privileges; end if;
    if exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name=name and grantee in ('PUBLIC','anon','authenticated')) then raise exception 'Public grant: %',name; end if;
  end loop;
  foreach name in array array['blindaje_bootstrap_external_payment(text,text,text,text)','blindaje_receive_payment_proof(text,text,text,text,text,text,text)'] loop
    if (select prosecdef from pg_proc where oid=('public.' || name)::regprocedure) then raise exception 'Unexpected definer'; end if;
    if not has_function_privilege('service_role','public.' || name,'EXECUTE') or has_function_privilege('anon','public.' || name,'EXECUTE') or has_function_privilege('authenticated','public.' || name,'EXECUTE') then raise exception 'Incorrect RPC grants: %',name; end if;
  end loop;
  if not exists (select 1 from storage.buckets where id='blindaje-payment-proofs' and not public and file_size_limit=5242880 and allowed_mime_types @> array['application/pdf','image/jpeg','image/png'] and cardinality(allowed_mime_types)=3) then raise exception 'Bucket incorrect'; end if;
end $$;
select 'PASS: private tables, exact grants, invoker RPCs, private bucket' as result;
