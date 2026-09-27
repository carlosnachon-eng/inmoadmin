begin;
drop function public.blindaje_review_investigation_payment(uuid,text,uuid,text,text);
create or replace function public.blindaje_bootstrap_external_payment(p_kind text, p_hash text, p_role text, p_payment_hash text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  claim public.blindaje_b2c_submission_tokens;
  invitation public.blindaje_partner_invitations;
  operation public.partner_operations;
  external_case public.blindaje_external_cases;
  record_id uuid; tenant_id uuid; owner_id uuid;
begin
  if p_kind = 'b2c' then
    select * into claim from public.blindaje_b2c_submission_tokens where token_hash = p_hash for update;
    if not found or claim.role is distinct from p_role or claim.expires_at <= now() then return null; end if;
    if p_role = 'inquilino' then
      select id into record_id from public.solicitudes_inquilino where blindaje_submission_claim_hash = p_hash and origen_operacion = 'b2c' for share;
      tenant_id := record_id;
    elsif p_role = 'propietario' then
      select id into record_id from public.propietarios_inmuebles where blindaje_submission_claim_hash = p_hash and origen_operacion = 'b2c' for share;
      owner_id := record_id;
    else return null;
    end if;
    if record_id is null then return null; end if;
    select * into external_case from public.blindaje_external_cases where origin_type = 'b2c' and
      ((tenant_id is not null and solicitud_inquilino_id = tenant_id) or (owner_id is not null and propietario_id = owner_id)) for update;
    -- A used claim may only recover its already-created case, never create another one.
    if claim.used_at is not null and external_case.id is null then return null; end if;
    if external_case.id is null then
      insert into public.blindaje_external_cases(origin_type,initiated_by_role,solicitud_inquilino_id,propietario_id)
      values ('b2c',p_role,tenant_id,owner_id) returning * into external_case;
    end if;
  elsif p_kind = 'partner' then
    select * into invitation from public.blindaje_partner_invitations where token_hash = p_hash for update;
    if not found or invitation.revoked_at is not null or invitation.expires_at <= now() or invitation.linked_record_id is null then return null; end if;
    select * into operation from public.partner_operations where id = invitation.partner_operation_id and partner_agency_id = invitation.partner_agency_id for update;
    if not found or operation.status_partner not in ('recibida','en_revision','faltan_documentos','aprobada','contrato_en_proceso','lista_para_firma','activa') then return null; end if;
    perform 1 from public.partner_agencies where id = invitation.partner_agency_id and status = 'activo' for share;
    if not found then return null; end if;
    -- Only the role actually authorized by this linked invitation is added to the case.
    if invitation.role = 'inquilino' then
      if operation.solicitud_inquilino_id is distinct from invitation.linked_record_id then return null; end if;
      select id into tenant_id from public.solicitudes_inquilino where id = invitation.linked_record_id and origen_operacion = 'partner' for share;
      if tenant_id is null then return null; end if;
    elsif invitation.role = 'propietario' then
      if operation.propietario_id is distinct from invitation.linked_record_id then return null; end if;
      select id into owner_id from public.propietarios_inmuebles where id = invitation.linked_record_id and origen_operacion = 'partner' for share;
      if owner_id is null then return null; end if;
    else return null;
    end if;
    select * into external_case from public.blindaje_external_cases where partner_operation_id = operation.id for update;
    if external_case.id is null then
      insert into public.blindaje_external_cases(origin_type,initiated_by_role,partner_operation_id,solicitud_inquilino_id,propietario_id)
      values ('partner',invitation.role,operation.id,tenant_id,owner_id) returning * into external_case;
    else
      if (tenant_id is not null and external_case.solicitud_inquilino_id is not null and external_case.solicitud_inquilino_id <> tenant_id)
        or (owner_id is not null and external_case.propietario_id is not null and external_case.propietario_id <> owner_id) then return null; end if;
      update public.blindaje_external_cases set solicitud_inquilino_id = coalesce(solicitud_inquilino_id,tenant_id),
        propietario_id = coalesce(propietario_id,owner_id), updated_at = now() where id = external_case.id;
    end if;
  else return null;
  end if;
  if external_case.status not in ('awaiting_payment','proof_received') then return null; end if;
  insert into public.blindaje_investigation_payments(case_id) values (external_case.id) on conflict (case_id) do nothing;
  insert into public.blindaje_case_access_tokens(case_id,token_hash,expires_at) values (external_case.id,p_payment_hash,now() + interval '30 days');
  if p_kind = 'b2c' then update public.blindaje_b2c_submission_tokens set used_at = coalesce(used_at,now()) where id = claim.id; end if;
  return external_case.folio;
end $$;
create or replace function public.blindaje_receive_payment_proof(p_hash text, p_expected_path text, p_path text, p_mime text, p_name text, p_payer_role text, p_payer_name text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare access_token public.blindaje_case_access_tokens; payment public.blindaje_investigation_payments; case_status text;
begin
  select * into access_token from public.blindaje_case_access_tokens where token_hash = p_hash and purpose = 'payment' and revoked_at is null and expires_at > now() for share;
  if not found then return false; end if;
  select status into case_status from public.blindaje_external_cases where id = access_token.case_id for update;
  if case_status not in ('awaiting_payment','proof_received') then return false; end if;
  select * into payment from public.blindaje_investigation_payments where case_id = access_token.case_id for update;
  if not found or payment.status not in ('pending','proof_received') or payment.proof_storage_path is distinct from p_expected_path then return false; end if;
  if p_payer_role is null or p_payer_role not in ('inquilino','propietario','tercero') or (p_payer_role = 'tercero' and coalesce(length(trim(p_payer_name)),0) = 0) then return false; end if;
  if p_mime is null or p_mime not in ('application/pdf','image/jpeg','image/png') or p_path is null or
    p_path !~ ('^cases/' || access_token.case_id::text || '/investigation/' || payment.id::text || '/[0-9a-f-]+\.(pdf|jpg|png)$') then return false; end if;
  update public.blindaje_investigation_payments set status = 'proof_received', payer_role = p_payer_role,
    payer_name = case when p_payer_role = 'tercero' then trim(p_payer_name) else null end,
    proof_storage_path = p_path, proof_content_type = p_mime, proof_original_name = p_name,
    proof_submitted_at = now(), updated_at = now() where id = payment.id;
  update public.blindaje_external_cases set status = 'proof_received', updated_at = now() where id = access_token.case_id;
  return true;
end $$;
alter table public.blindaje_investigation_payments drop constraint blindaje_review_validated, drop constraint blindaje_review_rejected, drop column rejected_by, drop column rejected_at;
drop table public.blindaje_investigation_ledger_entries;
commit;
