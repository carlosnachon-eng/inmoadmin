-- Confirmación determinística de un vínculo Respond -> identidad canónica.
-- No contiene backfill, seeds ni activación de capacidades.
begin;

create unique index if not exists respond_identity_audit_exact_phone_evidence_uidx
  on public.respond_identity_audit (
    link_id,
    event_type,
    (context_ids ->> 'evidenceVersion'),
    (context_ids ->> 'evidenceHash'),
    (coalesce(context_ids ->> 'reasonCode', 'confirmed'))
  )
  where context_ids ->> 'source' = 'exact_phone_unique';

create or replace function public.confirm_exact_phone_respond_identity_link(
  p_link_id uuid,
  p_respond_contact_id text,
  p_phone_digest text,
  p_effective_at timestamptz,
  p_evidence_version text,
  p_evidence_hash text,
  p_actor_profile_id uuid
) returns table(
  result_status text,
  result_reason text,
  link_id uuid,
  client_identity_id uuid,
  property_id uuid,
  contract_id uuid,
  confirmed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.respond_identity_links%rowtype;
  v_identity public.client_identities%rowtype;
  v_reason text;
  v_role text;
  v_role_count integer := 0;
  v_property_id uuid;
  v_property_count integer := 0;
  v_contract_id uuid;
  v_contract_count integer := 0;
  v_now timestamptz := now();
begin
  if p_respond_contact_id is null or length(p_respond_contact_id) not between 1 and 200
     or p_respond_contact_id ~ '[[:space:]/\\?&#]'
     or p_phone_digest !~ '^[a-f0-9]{64}$'
     or p_evidence_version <> 'exact_phone_unique_v1'
     or p_evidence_hash !~ '^[a-f0-9]{64}$'
     or p_effective_at is null then
    raise exception 'invalid_exact_phone_confirmation_input';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_actor_profile_id) then
    raise exception 'actor_not_authorized';
  end if;

  -- Serializa todo el conjunto vivo del contacto antes de evaluar o promover.
  perform 1 from public.respond_identity_links l
    where l.respond_contact_id = p_respond_contact_id
      and l.link_status in ('candidate','confirmed','conflict')
    order by l.id for update;
  select l.* into v_link from public.respond_identity_links l
    where l.id = p_link_id and l.respond_contact_id = p_respond_contact_id;
  if not found then
    raise exception 'candidate_not_found';
  end if;
  select ci.* into v_identity from public.client_identities ci where ci.id = v_link.client_identity_id for share;

  if v_link.link_status = 'confirmed'
     and v_link.link_source = 'exact_phone_unique'
     and v_identity.status = 'active'
     and v_identity.phone_digest = p_phone_digest
     and exists (
       select 1 from public.respond_identity_audit a
       where a.link_id = v_link.id and a.event_type = 'confirmed'
         and a.context_ids ->> 'evidenceVersion' = p_evidence_version
         and a.context_ids ->> 'evidenceHash' = p_evidence_hash
     ) then
    return query select 'already_confirmed'::text,null::text,v_link.id,v_link.client_identity_id,
      nullif((select a.context_ids ->> 'propertyId' from public.respond_identity_audit a where a.link_id=v_link.id and a.event_type='confirmed' and a.context_ids->>'evidenceHash'=p_evidence_hash limit 1),'')::uuid,
      nullif((select a.context_ids ->> 'contractId' from public.respond_identity_audit a where a.link_id=v_link.id and a.event_type='confirmed' and a.context_ids->>'evidenceHash'=p_evidence_hash limit 1),'')::uuid,
      v_link.confirmed_at;
    return;
  end if;

  if v_link.link_status <> 'candidate' or v_link.link_source <> 'exact_phone_unique'
     or v_link.reason_code <> 'exact_full_phone_unique_candidate' or v_link.confidence <> 0.950 then
    v_reason := 'candidate_not_exact_phone_unique';
  elsif v_identity.id is null or v_identity.status <> 'active' or v_identity.phone_digest <> p_phone_digest then
    v_reason := 'canonical_phone_mismatch';
  elsif (select count(*) from public.client_identities ci where ci.status='active' and ci.phone_digest=p_phone_digest) <> 1 then
    v_reason := 'canonical_phone_not_unique';
  elsif exists (
    select 1 from public.respond_identity_links l where l.respond_contact_id=p_respond_contact_id
      and l.link_status='confirmed' and l.client_identity_id is distinct from v_link.client_identity_id
  ) then
    v_reason := 'confirmed_link_conflict';
  elsif exists (
    select 1 from public.respond_identity_links l where l.client_identity_id=v_link.client_identity_id
      and l.respond_contact_id<>p_respond_contact_id and l.link_status in ('candidate','confirmed','conflict')
  ) then
    v_reason := 'respond_contact_not_unique';
  elsif exists (
    select 1 from public.client_source_links sl where sl.client_identity_id=v_link.client_identity_id and sl.link_status='revoked'
  ) then
    v_reason := 'revoked_relationship';
  end if;

  select count(distinct r.role_kind),min(r.role_kind)
    into v_role_count,v_role
    from public.client_identity_roles r
    where r.client_identity_id=v_link.client_identity_id and r.status='active';
  if v_reason is null and v_role_count <> 1 then v_reason := 'ambiguous_role_context'; end if;

  if v_reason is null and v_role = 'tenant' then
    select count(distinct c.property_id),(array_agg(distinct c.property_id order by c.property_id))[1],count(distinct c.id),(array_agg(distinct c.id order by c.id))[1]
      into v_property_count,v_property_id,v_contract_count,v_contract_id
      from public.client_source_links sl
      join public.contracts c on sl.source_type='active_contract_tenant' and c.id=sl.source_id
      join public.properties p on p.id=c.property_id
      where sl.client_identity_id=v_link.client_identity_id and sl.link_status='confirmed'
        and c.tenant_client_id=v_link.client_identity_id
        and lower(coalesce(c.status,'')) not in ('vencido','expired','cancelado','cancelled','terminado','ended')
        and (c.start_date is null or c.start_date<=p_effective_at::date)
        and (c.end_date is null or c.end_date>=p_effective_at::date)
        and lower(coalesce(p.status,'')) not in ('inactive','inactiva','inactivo','archived','archivada','disabled','deshabilitada');
    if v_property_count <> 1 then v_reason := case when v_property_count > 1 then 'ambiguous_property_context' else 'contract_not_current' end;
    elsif v_contract_count <> 1 then v_reason := 'ambiguous_contract_context'; end if;
  elsif v_reason is null and v_role = 'owner' then
    select count(distinct p.id),(array_agg(distinct p.id order by p.id))[1]
      into v_property_count,v_property_id
      from public.client_source_links sl
      join public.properties p on sl.source_type='managed_property_owner' and p.id=sl.source_id
      where sl.client_identity_id=v_link.client_identity_id and sl.link_status='confirmed'
        and p.owner_client_id=v_link.client_identity_id
        and lower(coalesce(p.status,'')) not in ('inactive','inactiva','inactivo','archived','archivada','disabled','deshabilitada');
    if v_property_count <> 1 then v_reason := case when v_property_count > 1 then 'ambiguous_property_context' else 'insufficient_property_context' end; end if;
    if v_reason is null then
      select count(distinct c.id),(array_agg(distinct c.id order by c.id))[1] into v_contract_count,v_contract_id
      from public.contracts c where c.property_id=v_property_id
        and lower(coalesce(c.status,'')) not in ('vencido','expired','cancelado','cancelled','terminado','ended')
        and (c.start_date is null or c.start_date<=p_effective_at::date)
        and (c.end_date is null or c.end_date>=p_effective_at::date);
      if v_contract_count > 1 then v_reason := 'ambiguous_contract_context'; end if;
    end if;
  end if;

  if v_reason is not null then
    insert into public.respond_identity_audit(link_id,respond_contact_id,event_type,actor_profile_id,context_ids)
    values(v_link.id,p_respond_contact_id,'unresolved',p_actor_profile_id,jsonb_build_object(
      'source','exact_phone_unique','evidenceVersion',p_evidence_version,'evidenceHash',p_evidence_hash,
      'reasonCode',v_reason,'clientIdentityId',v_link.client_identity_id,'propertyId',v_property_id,'contractId',v_contract_id
    )) on conflict do nothing;
    return query select 'rejected'::text,v_reason,v_link.id,v_link.client_identity_id,v_property_id,v_contract_id,null::timestamptz;
    return;
  end if;

  update public.respond_identity_links l set link_status='confirmed',confirmed_by=p_actor_profile_id,
    confirmed_at=v_now,reviewed_by=p_actor_profile_id,reviewed_at=v_now,updated_at=v_now
    where l.id=v_link.id and l.link_status='candidate';
  if not found then raise exception 'candidate_state_changed'; end if;
  insert into public.respond_identity_audit(link_id,respond_contact_id,event_type,actor_profile_id,context_ids)
  values(v_link.id,p_respond_contact_id,'confirmed',p_actor_profile_id,jsonb_build_object(
    'source','exact_phone_unique','evidenceVersion',p_evidence_version,'evidenceHash',p_evidence_hash,
    'clientIdentityId',v_link.client_identity_id,'propertyId',v_property_id,'contractId',v_contract_id,
    'roleKind',v_role,'effectiveAt',p_effective_at
  )) on conflict do nothing;
  return query select 'confirmed'::text,null::text,v_link.id,v_link.client_identity_id,v_property_id,v_contract_id,v_now;
end $$;

revoke all on function public.confirm_exact_phone_respond_identity_link(uuid,text,text,timestamptz,text,text,uuid) from public,anon,authenticated;
grant execute on function public.confirm_exact_phone_respond_identity_link(uuid,text,text,timestamptz,text,text,uuid) to service_role;

comment on function public.confirm_exact_phone_respond_identity_link(uuid,text,text,timestamptz,text,text,uuid)
  is 'Promoción atómica exact_phone_unique; revalida digest, unicidad, rol y relación temporal; auditoría sin PII nueva.';

commit;
