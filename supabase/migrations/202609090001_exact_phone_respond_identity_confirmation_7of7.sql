-- Confirmación exact_phone_unique limitada a la cohorte certificada 7/7.
-- Sin backfill, seeds, PII nueva ni activación de capacidades.
begin;

-- Retira explícitamente la firma v1: no debe sobrevivir una ruta que acepte
-- evidenceHash/digest controlados directamente por un caller.
drop function if exists public.confirm_exact_phone_respond_identity_link(uuid,text,text,timestamptz,text,text,uuid);

create unique index if not exists respond_identity_links_confirmed_identity_uidx
  on public.respond_identity_links(client_identity_id)
  where link_status = 'confirmed' and client_identity_id is not null;

create unique index if not exists respond_identity_audit_exact_phone_evidence_uidx
  on public.respond_identity_audit (
    link_id, event_type,
    (context_ids ->> 'evidenceVersion'),
    (context_ids ->> 'evidenceHash'),
    (coalesce(context_ids ->> 'reasonCode', 'confirmed'))
  ) where context_ids ->> 'source' = 'exact_phone_unique';

create or replace function public.confirm_exact_phone_respond_identity_link_core(
  p_candidate_ref text,
  p_link_id uuid,
  p_respond_contact_id text,
  p_observed_phone_digest text,
  p_effective_at timestamptz,
  p_evidence_version text,
  p_server_rejection_reason text,
  p_actor_profile_id uuid
) returns table(result_status text, result_reason text, link_id uuid, client_identity_id uuid,
  property_id uuid, contract_id uuid, confirmed_at timestamptz)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_link public.respond_identity_links%rowtype;
  v_identity public.client_identities%rowtype;
  v_reason text := p_server_rejection_reason;
  v_role text; v_role_count integer := 0;
  v_property_id uuid; v_property_count integer := 0;
  v_contract_id uuid; v_contract_count integer := 0;
  v_now timestamptz := now(); v_evidence_hash text;
begin
  if p_respond_contact_id is null or length(p_respond_contact_id) not between 1 and 200
     or p_respond_contact_id ~ '[[:space:]/\\?&#]' or p_effective_at is null
     or p_evidence_version <> 'exact_phone_unique_confirmation_v2'
     or (p_observed_phone_digest is not null and p_observed_phone_digest !~ '^[a-f0-9]{64}$')
     or (p_server_rejection_reason is not null and p_server_rejection_reason not in ('respond_contact_not_found','respond_phone_unusable','respond_read_error')) then
    raise exception 'invalid_exact_phone_confirmation_input';
  end if;
  if not exists(select 1 from public.profiles p where p.id=p_actor_profile_id and p.active is true and p.role_id='admin') then
    raise exception 'actor_not_authorized';
  end if;

  -- El orden de locks es siempre contacto -> identidad para todos los workers.
  perform pg_advisory_xact_lock(hashtextextended('respond:' || p_respond_contact_id, 0));
  select l.* into v_link from public.respond_identity_links l
    where l.id=p_link_id and l.respond_contact_id=p_respond_contact_id for update;
  if not found then raise exception 'candidate_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('identity:' || v_link.client_identity_id::text, 0));
  select ci.* into v_identity from public.client_identities ci where ci.id=v_link.client_identity_id for update;

  v_evidence_hash := encode(extensions.digest(concat_ws('|',p_evidence_version,p_candidate_ref,v_link.id::text,
    p_respond_contact_id,v_link.client_identity_id::text,coalesce(p_observed_phone_digest,''),p_effective_at::text,coalesce(v_reason,'')),'sha256'),'hex');

  if v_reason is null and (v_link.link_status not in ('candidate','confirmed') or v_link.link_source<>'exact_phone_unique'
     or v_link.reason_code<>'exact_full_phone_unique_candidate' or v_link.confidence<>0.950) then v_reason := 'candidate_not_exact_phone_unique'; end if;
  if v_reason is null and (v_identity.id is null or v_identity.status<>'active' or v_identity.phone_digest<>p_observed_phone_digest) then v_reason := 'canonical_phone_mismatch'; end if;
  if v_reason is null and (select count(*) from public.client_identities ci where ci.status='active' and ci.phone_digest=p_observed_phone_digest)<>1 then v_reason := 'canonical_phone_not_unique'; end if;
  if v_reason is null and exists(select 1 from public.respond_identity_links l where l.respond_contact_id=p_respond_contact_id and l.link_status='confirmed' and l.client_identity_id is distinct from v_link.client_identity_id) then v_reason := 'confirmed_link_conflict'; end if;
  if v_reason is null and exists(select 1 from public.respond_identity_links l where l.client_identity_id=v_link.client_identity_id and l.respond_contact_id<>p_respond_contact_id and l.link_status in ('candidate','confirmed','conflict')) then v_reason := 'respond_contact_not_unique'; end if;
  if v_reason is null and exists(select 1 from public.client_source_links sl where sl.client_identity_id=v_link.client_identity_id and (sl.link_status='revoked' or sl.revoked_at is not null)) then v_reason := 'revoked_relationship'; end if;

  select count(distinct r.role_kind),min(r.role_kind) into v_role_count,v_role from public.client_identity_roles r
    where r.client_identity_id=v_link.client_identity_id and r.status='active';
  if v_reason is null and v_role_count<>1 then v_reason := 'ambiguous_role_context'; end if;

  if v_reason is null and v_role='tenant' then
    select count(distinct c.property_id),(array_agg(distinct c.property_id order by c.property_id))[1],count(distinct c.id),(array_agg(distinct c.id order by c.id))[1]
      into v_property_count,v_property_id,v_contract_count,v_contract_id
      from public.client_source_links sl join public.contracts c on sl.source_type='active_contract_tenant' and c.id=sl.source_id
      join public.properties p on p.id=c.property_id
      where sl.client_identity_id=v_link.client_identity_id and sl.link_status='confirmed' and c.tenant_client_id=v_link.client_identity_id
        and lower(coalesce(c.status,'')) not in ('vencido','expired','cancelado','cancelled','terminado','ended')
        and (c.start_date is null or c.start_date<=p_effective_at::date) and (c.end_date is null or c.end_date>=p_effective_at::date)
        and lower(coalesce(p.status,'')) not in ('inactive','inactiva','inactivo','archived','archivada','disabled','deshabilitada');
    if v_property_count<>1 then v_reason := case when v_property_count>1 then 'ambiguous_property_context' else 'contract_not_current' end;
    elsif v_contract_count<>1 then v_reason := 'ambiguous_contract_context'; end if;
  elsif v_reason is null and v_role='owner' then
    select count(distinct p.id),(array_agg(distinct p.id order by p.id))[1] into v_property_count,v_property_id
      from public.client_source_links sl join public.properties p on sl.source_type='managed_property_owner' and p.id=sl.source_id
      where sl.client_identity_id=v_link.client_identity_id and sl.link_status='confirmed' and p.owner_client_id=v_link.client_identity_id
        and lower(coalesce(p.status,'')) not in ('inactive','inactiva','inactivo','archived','archivada','disabled','deshabilitada');
    if v_property_count<>1 then v_reason := case when v_property_count>1 then 'ambiguous_property_context' else 'insufficient_property_context' end; end if;
    if v_reason is null then
      select count(distinct c.id),(array_agg(distinct c.id order by c.id))[1] into v_contract_count,v_contract_id from public.contracts c
        where c.property_id=v_property_id and lower(coalesce(c.status,'')) not in ('vencido','expired','cancelado','cancelled','terminado','ended')
          and (c.start_date is null or c.start_date<=p_effective_at::date) and (c.end_date is null or c.end_date>=p_effective_at::date);
      if v_contract_count>1 then v_reason := 'ambiguous_contract_context'; end if;
    end if;
  end if;

  -- Un retry idempotente también debe revalidar evidencia, rol, propiedad y
  -- contrato actuales; nunca devuelve already_confirmed antes de esas guardas.
  if v_reason is null and v_link.link_status='confirmed' then
    if exists(select 1 from public.respond_identity_audit a where a.link_id=v_link.id and a.event_type='confirmed'
      and a.context_ids->>'evidenceVersion'=p_evidence_version) then
      return query select 'already_confirmed'::text,null::text,v_link.id,v_link.client_identity_id,
        v_property_id,v_contract_id,v_link.confirmed_at;
      return;
    end if;
    v_reason := 'confirmed_without_expected_audit';
  end if;

  if v_reason is not null then
    insert into public.respond_identity_audit(link_id,respond_contact_id,event_type,actor_profile_id,context_ids)
    values(v_link.id,p_respond_contact_id,'unresolved',p_actor_profile_id,jsonb_build_object('source','exact_phone_unique','cohortRef',p_candidate_ref,
      'evidenceVersion',p_evidence_version,'evidenceHash',v_evidence_hash,'observedAt',v_now,'reasonCode',v_reason,
      'clientIdentityId',v_link.client_identity_id,'propertyId',v_property_id,'contractId',v_contract_id)) on conflict do nothing;
    return query select 'rejected'::text,v_reason,v_link.id,v_link.client_identity_id,v_property_id,v_contract_id,null::timestamptz; return;
  end if;

  update public.respond_identity_links l set link_status='confirmed',confirmed_by=p_actor_profile_id,confirmed_at=v_now,
    reviewed_by=p_actor_profile_id,reviewed_at=v_now,updated_at=v_now where l.id=v_link.id and l.link_status='candidate';
  if not found then raise exception 'candidate_state_changed'; end if;
  insert into public.respond_identity_audit(link_id,respond_contact_id,event_type,actor_profile_id,context_ids)
  values(v_link.id,p_respond_contact_id,'confirmed',p_actor_profile_id,jsonb_build_object('source','exact_phone_unique','cohortRef',p_candidate_ref,
    'evidenceVersion',p_evidence_version,'evidenceHash',v_evidence_hash,'observedAt',v_now,'clientIdentityId',v_link.client_identity_id,
    'propertyId',v_property_id,'contractId',v_contract_id,'roleKind',v_role,'effectiveAt',p_effective_at)) on conflict do nothing;
  return query select 'confirmed'::text,null::text,v_link.id,v_link.client_identity_id,v_property_id,v_contract_id,v_now;
end $$;

-- Único entrypoint para la aplicación. El core queda reservado al owner de DB
-- para checks transaccionales con fixtures sintéticos en DEV.
create or replace function public.confirm_exact_phone_respond_identity_link(
  p_candidate_ref text,
  p_link_id uuid,
  p_respond_contact_id text,
  p_observed_phone_digest text,
  p_effective_at timestamptz,
  p_evidence_version text,
  p_server_rejection_reason text,
  p_actor_profile_id uuid
) returns table(result_status text, result_reason text, link_id uuid, client_identity_id uuid,
  property_id uuid, contract_id uuid, confirmed_at timestamptz)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_allowed_refs constant text[] := array['41e6ed66d3d1','ed8a9ccc90bf','6cc445029b1f','ef4acc9b3ae8','410cdab75f6f','8cff19a394fc','535a7956cd78'];
begin
  if p_candidate_ref is null or not (p_candidate_ref = any(v_allowed_refs)) then
    raise exception 'candidate_ref_not_in_certified_cohort';
  end if;
  if substr(encode(extensions.digest(p_link_id::text,'sha256'),'hex'),1,12) <> p_candidate_ref then
    raise exception 'candidate_ref_link_mismatch';
  end if;
  return query select * from public.confirm_exact_phone_respond_identity_link_core(
    p_candidate_ref,p_link_id,p_respond_contact_id,p_observed_phone_digest,p_effective_at,
    p_evidence_version,p_server_rejection_reason,p_actor_profile_id
  );
end $$;

revoke all on function public.confirm_exact_phone_respond_identity_link_core(text,uuid,text,text,timestamptz,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.confirm_exact_phone_respond_identity_link(text,uuid,text,text,timestamptz,text,text,uuid) from public,anon,authenticated;
grant execute on function public.confirm_exact_phone_respond_identity_link(text,uuid,text,text,timestamptz,text,text,uuid) to service_role;
comment on function public.confirm_exact_phone_respond_identity_link_core(text,uuid,text,text,timestamptz,text,text,uuid)
  is 'Core transaccional no expuesto a roles de aplicación; reservado a wrapper y certificación sintética DEV por owner.';
comment on function public.confirm_exact_phone_respond_identity_link(text,uuid,text,text,timestamptz,text,text,uuid)
  is 'Confirmación individual, atómica e idempotente exact_phone_unique; cohorte inmutable 7/7 y evidencia derivada dentro del servidor SQL.';
commit;
