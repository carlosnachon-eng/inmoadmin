-- Additive DEV-certified capability. No seed/backfill, portal grants or flags.
begin;

-- Opaque relation revision: no owner name/phone is copied into identity evidence.
-- Changes to recorded ownership invalidate approval even when the phone stays the same.
alter table public.unidades_condominio add column identity_owner_version bigint not null default 1 check (identity_owner_version>0);
create function public.version_condominium_owner_identity() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  new.identity_owner_version:=old.identity_owner_version + case when
    old.propietario_nombre is distinct from new.propietario_nombre or old.propietario_telefono is distinct from new.propietario_telefono
    or old.condominio_id is distinct from new.condominio_id or old.activo is distinct from new.activo then 1 else 0 end;
  return new;
end $$;
create trigger condominium_owner_identity_version before update on public.unidades_condominio
  for each row execute function public.version_condominium_owner_identity();

alter table public.client_source_links drop constraint client_source_links_source_type_check;
alter table public.client_source_links add constraint client_source_links_source_type_check
  check (source_type in ('active_contract_tenant','managed_property_owner','condominium_unit_owner'));
alter table public.client_reconciliation_candidate_sources drop constraint client_reconciliation_candidate_sources_source_type_check;
alter table public.client_reconciliation_candidate_sources add constraint client_reconciliation_candidate_sources_source_type_check
  check (source_type in ('active_contract_tenant','managed_property_owner','condominium_unit_owner'));
alter table public.client_source_links add column condominium_id uuid references public.condominios(id) on delete restrict;
alter table public.client_reconciliation_candidate_sources add column condominium_id uuid references public.condominios(id) on delete restrict;
alter table public.client_source_links add column source_version bigint;
alter table public.client_reconciliation_candidate_sources add column source_version bigint;
alter table public.client_source_links add constraint condominium_source_scope check (
  (source_type='condominium_unit_owner' and condominium_id is not null and source_version is not null and source_version>0 and role_kind='owner')
  or (source_type<>'condominium_unit_owner' and condominium_id is null));
alter table public.client_reconciliation_candidate_sources add constraint condominium_candidate_scope check (
  (source_type='condominium_unit_owner' and condominium_id is not null and source_version is not null and source_version>0 and matched_property_id is null)
  or (source_type<>'condominium_unit_owner' and condominium_id is null));
alter table public.client_reconciliation_candidates
  add column respond_contact_id text,
  add column evidence_version text,
  add column evidence_hash text check (evidence_hash is null or evidence_hash ~ '^[a-f0-9]{64}$'),
  add column respond_checked_at timestamptz;
alter table public.respond_identity_links drop constraint respond_identity_links_link_source_check;
alter table public.respond_identity_links add constraint respond_identity_links_link_source_check check
  (link_source in ('explicit_operational_link','human_confirmation','exact_phone_unique','exact_phone_conflict','condominium_owner_admin_review'));

-- Polymorphic source integrity: a unit is never a rental property.
create function public.check_condominium_identity_source() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.source_type='condominium_unit_owner' and not exists (
    select 1 from public.unidades_condominio u where u.id=new.source_id and u.condominio_id=new.condominium_id
  ) then raise exception 'condominium_source_scope_mismatch'; end if;
  if new.source_type='condominium_unit_owner' and new.source_version is null then
    select identity_owner_version into new.source_version from public.unidades_condominio where id=new.source_id; end if;
  return new;
end $$;
create trigger condominium_identity_source_guard before insert or update on public.client_source_links
  for each row execute function public.check_condominium_identity_source();
create trigger condominium_candidate_source_guard before insert or update on public.client_reconciliation_candidate_sources
  for each row execute function public.check_condominium_identity_source();

-- Same algorithm as normalizeIdentityPhone, including strict invalid-number rejection.
create function public.condominium_identity_phone_digest(p_phone text) returns text
language sql immutable set search_path=public,extensions,pg_temp as $$
  with d as (select regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') n)
  select encode(extensions.digest(case when length(n)=10 then '52'||n
    when length(n)=12 and left(n,2)='52' then n
    when length(n)=13 and left(n,3)='521' then '52'||substring(n from 4) else null end,'sha256'),'hex') from d;
$$;

-- Keep the legacy entry points/signatures for Rentas, but close their condo bypass.
alter function public.confirm_client_reconciliation_candidate(uuid,uuid,uuid) rename to confirm_rental_client_candidate_v1;
alter function public.review_client_reconciliation_candidate(uuid,uuid,text) rename to review_rental_client_candidate_v1;
revoke all on function public.confirm_rental_client_candidate_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.review_rental_client_candidate_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.confirm_client_reconciliation_candidate(p_candidate_id uuid,p_actor_profile_id uuid,p_existing_identity_id uuid default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.client_reconciliation_candidate_sources where candidate_id=p_candidate_id and source_type='condominium_unit_owner') then
    raise exception 'condominium_review_required'; end if;
  return public.confirm_rental_client_candidate_v1(p_candidate_id,p_actor_profile_id,p_existing_identity_id);
end $$;
create function public.review_client_reconciliation_candidate(p_candidate_id uuid,p_actor_profile_id uuid,p_action text)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.client_reconciliation_candidate_sources where candidate_id=p_candidate_id and source_type='condominium_unit_owner') then
    raise exception 'condominium_review_required'; end if;
  return public.review_rental_client_candidate_v1(p_candidate_id,p_actor_profile_id,p_action);
end $$;

-- One source per human review. Phone matches never group/merge people.
-- Trusted server alone supplies fresh Respond evidence; browser inputs cannot supply a digest/hash.
create function public.review_condominium_owner_identity(
  p_action text, p_unit_id uuid, p_respond_contact_id text, p_actor_profile_id uuid,
  p_observed_digest text default null, p_observed_at timestamptz default null,
  p_candidate_id uuid default null, p_server_rejection text default null,
  p_attach_confirmed_identity boolean default false
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  u public.unidades_condominio%rowtype;
  candidate public.client_reconciliation_candidates%rowtype;
  source_link public.client_source_links%rowtype;
  identity_id uuid; respond_link_id uuid; candidate_id uuid; anchor_identity_id uuid;
  reason text; evidence text; key text; n integer;
  result_status text; now_at timestamptz:=clock_timestamp();
  version constant text:='condominium_owner_review_v1';
begin
  if p_action is null or p_action not in ('prepare','confirm','reject','revoke') or p_unit_id is null
    or p_respond_contact_id is null or p_respond_contact_id !~ '^[A-Za-z0-9._:-]{1,200}$' then
    raise exception 'invalid_condominium_review'; end if;
  perform 1 from public.profiles where id=p_actor_profile_id and active is true and role_id='admin' for share;
  if not found then raise exception 'actor_not_authorized'; end if;
  if p_action<>'prepare' and p_candidate_id is null then raise exception 'candidate_required'; end if;
  if p_server_rejection is not null and p_server_rejection not in ('respond_read_error','respond_contact_not_found','respond_phone_unusable') then
    raise exception 'invalid_server_evidence'; end if;
  -- Compatible contact/identity namespaces with certified 7/7; that operation is unchanged.
  perform pg_advisory_xact_lock(hashtextextended('respond:'||p_respond_contact_id,0));
  perform pg_advisory_xact_lock(hashtextextended('condominium-unit:'||p_unit_id::text,0));
  -- Freeze source phone/active/scope during review, including matching-row phantoms.
  lock table public.unidades_condominio, public.condominios in share mode;
  select * into u from public.unidades_condominio where id=p_unit_id;
  if not found then reason:='unit_not_found'; end if;
  key:=encode(extensions.digest('condominium_unit_owner:'||p_unit_id::text||':'||p_respond_contact_id,'sha256'),'hex');
  select * into candidate from public.client_reconciliation_candidates where candidate_key=key for update;
  candidate_id:=candidate.id;
  if p_action<>'prepare' and (candidate.id is null or candidate.id is distinct from p_candidate_id
    or candidate.respond_contact_id is distinct from p_respond_contact_id
    or not exists(select 1 from public.client_reconciliation_candidate_sources s where s.candidate_id=candidate.id and s.source_type='condominium_unit_owner' and s.source_id=p_unit_id and s.condominium_id=u.condominio_id)) then
    raise exception 'candidate_scope_mismatch'; end if;
  select * into source_link from public.client_source_links where source_type='condominium_unit_owner' and source_id=p_unit_id for update;
  identity_id:=source_link.client_identity_id;
  -- An additional unit is an explicit human-reviewed association to the SAME already
  -- confirmed Respond contact, never a merge chosen by phone/name or caller identity UUID.
  if (p_action='prepare' and p_attach_confirmed_identity is true)
    or candidate.reason_code='condominium_additional_unit_review' then
    select count(*), (array_agg(l.client_identity_id))[1] into n,anchor_identity_id from public.respond_identity_links l
      where l.respond_contact_id=p_respond_contact_id and l.link_status='confirmed' and l.link_source='condominium_owner_admin_review';
    if n<>1 or not exists(select 1 from public.client_source_links s where s.client_identity_id=anchor_identity_id
      and s.source_type='condominium_unit_owner' and s.link_status='confirmed' and s.source_id<>p_unit_id)
      or (candidate.id is not null and candidate.client_identity_id is distinct from anchor_identity_id)
      or (identity_id is not null and identity_id is distinct from anchor_identity_id) then
      reason:='approved_identity_anchor_required';
    else identity_id:=anchor_identity_id; end if;
  end if;
  if identity_id is not null then perform pg_advisory_xact_lock(hashtextextended('identity:'||identity_id::text,0)); end if;

  if p_action in ('reject','revoke') then
    if p_action='reject' and candidate.candidate_status='confirmed' then raise exception 'explicit_revoke_required'; end if;
    if p_action='revoke' and candidate.candidate_status not in ('confirmed','revoked') then raise exception 'candidate_not_confirmed'; end if;
    if candidate.candidate_status=(case when p_action='revoke' then 'revoked' else 'skipped' end) then
      return jsonb_build_object('status','already_'||p_action,'candidate_id',candidate.id); end if;
    if p_action='revoke' then
      update public.client_source_links set link_status='revoked',revoked_at=now_at,updated_at=now_at where id=source_link.id;
      if not exists(select 1 from public.client_source_links where client_identity_id=identity_id and source_type='condominium_unit_owner' and link_status='confirmed') then
        update public.respond_identity_links set link_status='revoked',confirmed_by=null,confirmed_at=null,revoked_at=now_at,updated_at=now_at
          where client_identity_id=identity_id and respond_contact_id=p_respond_contact_id and link_source='condominium_owner_admin_review' returning id into respond_link_id;
      end if;
    end if;
    update public.client_reconciliation_candidates set candidate_status=case when p_action='revoke' then 'revoked' else 'skipped' end,
      reviewed_by=p_actor_profile_id,reviewed_at=now_at,updated_at=now_at where id=candidate.id;
    insert into public.client_identity_audit(candidate_id,client_identity_id,event_type,actor_profile_id,context_ids)
      values(candidate.id,identity_id,case when p_action='revoke' then 'revoked' else 'rejected' end,p_actor_profile_id,
      jsonb_build_object('sourceType','condominium_unit_owner','unitId',u.id,'condominiumId',u.condominio_id,'version',version));
    if respond_link_id is not null then insert into public.respond_identity_audit(link_id,respond_contact_id,event_type,actor_profile_id,context_ids)
      values(respond_link_id,p_respond_contact_id,'revoked',p_actor_profile_id,jsonb_build_object('sourceType','condominium_unit_owner','candidateId',candidate.id)); end if;
    return jsonb_build_object('status',case when p_action='revoke' then 'revoked' else 'rejected' end,'candidate_id',candidate.id);
  end if;

  now_at:=clock_timestamp();
  reason:=coalesce(reason,p_server_rejection);
  if reason is null and (p_observed_at is null or p_observed_at<now_at-interval '60 seconds' or p_observed_at>now_at+interval '5 seconds'
    or p_observed_digest is null or p_observed_digest !~ '^[a-f0-9]{64}$') then reason:='fresh_respond_evidence_required'; end if;
  if reason is null and (u.activo is not true or not exists(select 1 from public.condominios where id=u.condominio_id and activo is true)) then reason:='inactive_unit_or_condominium'; end if;
  if reason is null and public.condominium_identity_phone_digest(u.propietario_telefono) is distinct from p_observed_digest then reason:='source_phone_mismatch'; end if;
  if reason is null and (source_link.link_status='revoked' or candidate.candidate_status='revoked') then reason:='revoked_relationship'; end if;
  if reason is null and source_link.id is not null and source_link.link_status<>'confirmed' then reason:='unapproved_structured_relationship'; end if;
  if reason is null and candidate.id is not null and candidate.phone_digest is distinct from p_observed_digest then reason:='candidate_evidence_changed'; end if;
  if reason is null and candidate.id is not null and exists(select 1 from public.client_reconciliation_candidate_sources s where s.candidate_id=candidate.id
    and s.source_type='condominium_unit_owner' and s.source_version is distinct from u.identity_owner_version) then reason:='source_relationship_changed'; end if;
  if reason is null and source_link.id is not null and source_link.source_version is distinct from u.identity_owner_version then reason:='source_relationship_changed'; end if;
  if reason is null and p_action='confirm' and candidate.candidate_status not in ('requires_review','confirmed') then reason:='candidate_not_confirmable'; end if;
  -- Existing mappings may establish one identity across several units. Equal phone alone may not.
  if reason is null and exists(select 1 from public.unidades_condominio other
    where other.id<>u.id and public.condominium_identity_phone_digest(other.propietario_telefono)=p_observed_digest
    and (identity_id is null or not exists(select 1 from public.client_source_links s where s.source_type='condominium_unit_owner'
      and s.source_id=other.id and s.condominium_id=other.condominio_id and s.client_identity_id=identity_id and s.link_status='confirmed'))) then
    reason:='shared_phone_requires_structured_identity'; end if;
  if reason is null and exists(select 1 from public.client_reconciliation_candidate_sources s join public.client_reconciliation_candidates c on c.id=s.candidate_id
    where s.source_type='condominium_unit_owner' and s.source_id=u.id and c.candidate_key<>key) then reason:='source_candidate_conflict'; end if;

  -- Serialize identity creation, including callers that do not use our phone advisory lock.
  lock table public.client_identities in share row exclusive mode;
  -- Locks can wait: validate freshness again at the actual write boundary.
  now_at:=clock_timestamp();
  if reason is null and p_observed_at<now_at-interval '60 seconds' then reason:='fresh_respond_evidence_required'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_profile_id and active is true and role_id='admin') then
    raise exception 'actor_not_authorized'; end if;
  if reason is null and identity_id is null and exists(select 1 from public.client_identities where phone_digest=p_observed_digest) then reason:='existing_identity_requires_structured_link'; end if;
  if reason is null and identity_id is not null and not exists(select 1 from public.client_identities where id=identity_id and status='active' and phone_digest=p_observed_digest and revoked_at is null) then reason:='canonical_identity_conflict'; end if;
  if reason is null and identity_id is not null and exists(select 1 from public.client_identities where id<>identity_id and phone_digest=p_observed_digest) then reason:='multiple_canonical_identities'; end if;
  if reason is null and exists(select 1 from public.respond_identity_links l where (l.respond_contact_id=p_respond_contact_id or (identity_id is not null and l.client_identity_id=identity_id))
    and (l.respond_contact_id<>p_respond_contact_id or l.client_identity_id is distinct from identity_id or l.link_source<>'condominium_owner_admin_review' or l.link_status not in ('candidate','confirmed'))) then reason:='respond_identity_conflict'; end if;
  if reason is null and identity_id is not null and exists(select 1 from public.client_identity_roles where client_identity_id=identity_id and (role_kind<>'owner' or status<>'active')) then reason:='canonical_role_conflict'; end if;
  if reason is null and identity_id is not null and exists(select 1 from public.client_source_links where client_identity_id=identity_id and source_type<>'condominium_unit_owner') then reason:='mixed_domain_requires_structured_review'; end if;
  if reason is null and identity_id is not null and exists(
    select 1 from public.client_source_links s left join public.unidades_condominio au on au.id=s.source_id
      left join public.condominios ac on ac.id=au.condominio_id
    where s.client_identity_id=identity_id and s.source_type='condominium_unit_owner' and s.link_status='confirmed'
      and (au.id is null or au.condominio_id is distinct from s.condominium_id or au.identity_owner_version is distinct from s.source_version or au.activo is not true or ac.activo is not true
        or public.condominium_identity_phone_digest(au.propietario_telefono) is distinct from p_observed_digest)
  ) then reason:='approved_identity_anchor_changed'; end if;
  evidence:=encode(extensions.digest(concat_ws('|',version,p_action,p_respond_contact_id,p_unit_id::text,u.condominio_id::text,
    u.identity_owner_version::text,identity_id::text,anchor_identity_id::text,p_observed_digest,p_observed_at::text,coalesce(reason,'verified')),'sha256'),'hex');
  if reason is not null then
    insert into public.client_identity_audit(candidate_id,event_type,actor_profile_id,context_ids) values(candidate_id,'rejected',p_actor_profile_id,
      jsonb_build_object('sourceType','condominium_unit_owner','unitId',p_unit_id,'condominiumId',u.condominio_id,'reasonCode',reason,'evidenceHash',evidence,'version',version));
    return jsonb_build_object('status','rejected','reason',reason,'candidate_id',candidate_id);
  end if;
  if p_action='prepare' then
    if candidate.id is not null then return jsonb_build_object('status',candidate.candidate_status,'candidate_id',candidate.id,'reason','already_prepared'); end if;
    insert into public.client_reconciliation_candidates(candidate_key,role_kind,phone_digest,candidate_status,reason_code,source_count,client_identity_id,
      respond_contact_id,evidence_version,evidence_hash,respond_checked_at)
    values(key,'owner',p_observed_digest,'requires_review',case when anchor_identity_id is not null then 'condominium_additional_unit_review' else 'exact_phone_condominium_owner_candidate' end,
      1,identity_id,p_respond_contact_id,version,evidence,p_observed_at) returning id into candidate_id;
    insert into public.client_reconciliation_candidate_sources(candidate_id,source_type,source_id,condominium_id)
      values(candidate_id,'condominium_unit_owner',u.id,u.condominio_id);
    insert into public.client_identity_audit(candidate_id,event_type,actor_profile_id,context_ids) values(candidate_id,'candidate_prepared',p_actor_profile_id,
      jsonb_build_object('sourceType','condominium_unit_owner','unitId',u.id,'condominiumId',u.condominio_id,'evidenceHash',evidence,'version',version));
    return jsonb_build_object('status','requires_review','candidate_id',candidate_id);
  end if;
  if candidate.candidate_status='confirmed' then
    if source_link.link_status<>'confirmed' or not exists(select 1 from public.respond_identity_links where respond_contact_id=p_respond_contact_id and client_identity_id=identity_id and link_source='condominium_owner_admin_review' and link_status='confirmed') then raise exception 'confirmed_state_inconsistent'; end if;
    return jsonb_build_object('status','already_confirmed','candidate_id',candidate.id); end if;
  if identity_id is null then
    insert into public.client_identities(status,phone_digest) values('active',p_observed_digest) returning id into identity_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('identity:'||identity_id::text,0));
  insert into public.client_identity_roles(client_identity_id,role_kind) values(identity_id,'owner') on conflict do nothing;
  insert into public.client_source_links(client_identity_id,source_type,source_id,condominium_id,role_kind,link_status,match_method,confirmed_by,confirmed_at)
    values(identity_id,'condominium_unit_owner',u.id,u.condominio_id,'owner','confirmed','exact_full_phone_human_confirmed',p_actor_profile_id,now_at) on conflict (source_type,source_id) do nothing;
  select id into respond_link_id from public.respond_identity_links where respond_contact_id=p_respond_contact_id and client_identity_id=identity_id and link_source='condominium_owner_admin_review' and link_status='confirmed';
  if respond_link_id is null then
    insert into public.respond_identity_links(respond_contact_id,client_identity_id,link_status,link_source,confidence,reason_code,confirmed_by,confirmed_at,reviewed_by,reviewed_at)
      values(p_respond_contact_id,identity_id,'confirmed','condominium_owner_admin_review',1,'condominium_owner_human_approved',p_actor_profile_id,now_at,p_actor_profile_id,now_at) returning id into respond_link_id;
    insert into public.respond_identity_audit(link_id,respond_contact_id,event_type,actor_profile_id,context_ids) values(respond_link_id,p_respond_contact_id,'confirmed',p_actor_profile_id,
      jsonb_build_object('sourceType','condominium_unit_owner','unitId',u.id,'condominiumId',u.condominio_id,'evidenceHash',evidence,'version',version));
  end if;
  update public.client_reconciliation_candidates set candidate_status='confirmed',client_identity_id=identity_id,reviewed_by=p_actor_profile_id,
    reviewed_at=now_at,updated_at=now_at,evidence_hash=evidence,respond_checked_at=p_observed_at where id=candidate.id;
  insert into public.client_identity_audit(candidate_id,client_identity_id,event_type,actor_profile_id,context_ids) values(candidate.id,identity_id,'confirmed',p_actor_profile_id,
    jsonb_build_object('sourceType','condominium_unit_owner','unitId',u.id,'condominiumId',u.condominio_id,'evidenceHash',evidence,'version',version));
  return jsonb_build_object('status','confirmed','candidate_id',candidate.id);
end $$;

revoke all on function public.check_condominium_identity_source() from public,anon,authenticated,service_role;
revoke all on function public.version_condominium_owner_identity() from public,anon,authenticated,service_role;
revoke all on function public.condominium_identity_phone_digest(text) from public,anon,authenticated;
revoke all on function public.review_condominium_owner_identity(text,uuid,text,uuid,text,timestamptz,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.confirm_client_reconciliation_candidate(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.review_client_reconciliation_candidate(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_condominium_owner_identity(text,uuid,text,uuid,text,timestamptz,uuid,text,boolean) to service_role;
grant execute on function public.confirm_client_reconciliation_candidate(uuid,uuid,uuid) to service_role;
grant execute on function public.review_client_reconciliation_candidate(uuid,uuid,text) to service_role;
commit;
