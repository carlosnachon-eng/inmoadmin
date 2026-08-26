-- DEV-only, transaccional y sin persistencia: valida confirmación, roles, FKs y discovery.
begin;
do $$
declare
  v_actor uuid;
  v_contract uuid;
  v_property uuid;
  v_candidate uuid := gen_random_uuid();
  v_identity uuid;
  v_digest text := encode(digest('fase3a-canonical-client-dev-smoke','sha256'),'hex');
  v_matches integer;
begin
  select id into v_actor from public.profiles where active=true and role_id in ('admin','coord_operaciones') limit 1;
  select c.id,p.id into v_contract,v_property
    from public.contracts c join public.properties p on lower(trim(p.name))=lower(trim(c.property_name))
    where lower(coalesce(c.status,'')) in ('activo','active') limit 1;
  if v_actor is null or v_contract is null or v_property is null then raise exception 'smoke_prerequisite_missing'; end if;

  insert into public.client_reconciliation_candidates(id,candidate_key,role_kind,phone_digest,candidate_status,reason_code,source_count)
    values(v_candidate,encode(digest('fase3a-candidate-dev-smoke','sha256'),'hex'),'tenant',v_digest,'auto_safe_candidate','exact_phone_unique_active_tenant',1);
  insert into public.client_reconciliation_candidate_sources(candidate_id,source_type,source_id,matched_property_id)
    values(v_candidate,'active_contract_tenant',v_contract,v_property);
  v_identity := public.confirm_client_reconciliation_candidate(v_candidate,v_actor,null);
  if not exists(select 1 from public.client_identities where id=v_identity and auth_user_id is null and status='active') then raise exception 'identity_not_created'; end if;
  if not exists(select 1 from public.client_identity_roles where client_identity_id=v_identity and role_kind='tenant' and status='active') then raise exception 'role_not_created'; end if;
  if not exists(select 1 from public.client_source_links where client_identity_id=v_identity and source_id=v_contract and link_status='confirmed') then raise exception 'source_link_not_created'; end if;
  if not exists(select 1 from public.contracts where id=v_contract and tenant_client_id=v_identity and property_id=v_property) then raise exception 'contract_fk_not_linked'; end if;
  select count(*) into v_matches from public.find_respond_identity_candidates(v_digest) where client_identity_id=v_identity and contract_id=v_contract and property_id=v_property;
  if v_matches <> 1 then raise exception 'canonical_discovery_failed'; end if;
  if not exists(select 1 from public.client_identity_audit where candidate_id=v_candidate and event_type='confirmed') then raise exception 'audit_missing'; end if;
end $$;
rollback;
