-- Read-only checks. No fixtures, candidate creation, confirmations or data writes.
do $$
declare f text;
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='client_source_links' and column_name='condominium_id') then
    raise exception 'missing_condominium_scope'; end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('condominium_identity_source_guard','condominium_candidate_source_guard'))<>2 then
    raise exception 'missing_source_integrity_guards'; end if;
  if not exists(select 1 from pg_trigger where not tgisinternal and tgname='condominium_owner_identity_version') then
    raise exception 'missing_owner_revision_guard'; end if;
  select pg_get_functiondef('public.review_condominium_owner_identity(text,uuid,text,uuid,text,timestamptz,uuid,text,boolean)'::regprocedure) into f;
  if position('actor_not_authorized' in f)=0 or position('fresh_respond_evidence_required' in f)=0
    or position('shared_phone_requires_structured_identity' in f)=0 or position('respond_identity_conflict' in f)=0
    or position('revoked_relationship' in f)=0 or position('condominium-unit:' in f)=0
    or position('identity:' in f)=0 or position('respond:' in f)=0 or position('source_relationship_changed' in f)=0 then raise exception 'missing_confirmation_guards'; end if;
  if has_function_privilege('anon','public.review_condominium_owner_identity(text,uuid,text,uuid,text,timestamptz,uuid,text,boolean)','execute')
    or has_function_privilege('authenticated','public.review_condominium_owner_identity(text,uuid,text,uuid,text,timestamptz,uuid,text,boolean)','execute')
    or not has_function_privilege('service_role','public.review_condominium_owner_identity(text,uuid,text,uuid,text,timestamptz,uuid,text,boolean)','execute') then
    raise exception 'invalid_review_permissions'; end if;
  if has_function_privilege('service_role','public.confirm_rental_client_candidate_v1(uuid,uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.confirm_rental_client_candidate_v1(uuid,uuid,uuid)','execute') then
    raise exception 'legacy_core_exposed'; end if;
  if position('condominium_review_required' in pg_get_functiondef('public.confirm_client_reconciliation_candidate(uuid,uuid,uuid)'::regprocedure))=0
    or position('condominium_review_required' in pg_get_functiondef('public.review_client_reconciliation_candidate(uuid,uuid,text)'::regprocedure))=0 then
    raise exception 'legacy_review_bypass'; end if;
  if public.condominium_identity_phone_digest('+52 1 555 010 0001') is distinct from public.condominium_identity_phone_digest('5550100001')
    or public.condominium_identity_phone_digest('1234') is not null then raise exception 'phone_normalization_mismatch'; end if;
  raise notice 'PASS 202609180001 condominium owner canonical identity';
end $$;
