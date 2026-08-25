-- Read-only checks. No URL/ciphertext values are selected.
do $$ begin
  if to_regclass('public.shadow_media_retrieval_queue') is null then raise exception 'missing shadow_media_retrieval_queue'; end if;
  if not (select relrowsecurity from pg_class where oid='public.shadow_media_retrieval_queue'::regclass) then raise exception 'RLS disabled'; end if;
  if has_table_privilege('anon','public.shadow_media_retrieval_queue','SELECT') or has_table_privilege('authenticated','public.shadow_media_retrieval_queue','SELECT') then raise exception 'client read access present'; end if;
  if has_table_privilege('anon','public.shadow_media_retrieval_queue','INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.shadow_media_retrieval_queue','INSERT,UPDATE,DELETE') then raise exception 'client write access present'; end if;
  if not has_table_privilege('service_role','public.shadow_media_retrieval_queue','SELECT,INSERT,UPDATE,DELETE') then raise exception 'service_role grants missing'; end if;
  if to_regprocedure('public.claim_shadow_media_retrieval(uuid,timestamptz)') is null or to_regprocedure('public.complete_shadow_media_retrieval(uuid,uuid,jsonb)') is null or to_regprocedure('public.fail_shadow_media_retrieval(uuid,uuid,text,timestamptz,text)') is null then raise exception 'worker RPC missing'; end if;
end $$;
select status,count(*) from public.shadow_media_retrieval_queue group by status order by status;
