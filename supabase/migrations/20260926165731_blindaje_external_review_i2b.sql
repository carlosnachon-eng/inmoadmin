begin;
alter table public.blindaje_investigation_payments
  add column rejected_by uuid,
  add column rejected_at timestamptz,
  add constraint blindaje_review_validated check (status <> 'validated' or (validated_by is not null and validated_at is not null)),
  add constraint blindaje_review_rejected check (status <> 'rejected' or (rejected_by is not null and rejected_at is not null and rejection_reason is not null and length(btrim(rejection_reason)) between 3 and 300));
create table public.blindaje_investigation_ledger_entries (
  payment_id uuid primary key references public.blindaje_investigation_payments(id),
  poliza_caja_id uuid not null unique references public.poliza_caja(id),
  created_at timestamptz not null default now()
);
alter table public.blindaje_investigation_ledger_entries enable row level security;
revoke all on public.blindaje_investigation_ledger_entries from public, anon, authenticated, service_role;
grant select, insert on public.blindaje_investigation_ledger_entries to service_role;

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
      select id into record_id from public.solicitudes_inquilino where blindaje_submission_claim_hash = p_hash and origen_operacion = 'b2c' ;
      tenant_id := record_id;
    elsif p_role = 'propietario' then
      select id into record_id from public.propietarios_inmuebles where blindaje_submission_claim_hash = p_hash and origen_operacion = 'b2c' ;
      owner_id := record_id;
    else return null;
    end if;
    if record_id is null then return null; end if;
    select * into external_case from public.blindaje_external_cases where origin_type = 'b2c' and
      ((tenant_id is not null and solicitud_inquilino_id = tenant_id) or (owner_id is not null and propietario_id = owner_id));

    if external_case.id is not null then
      perform 1 from public.blindaje_investigation_payments where case_id = external_case.id for update;
      select * into external_case from public.blindaje_external_cases where id = external_case.id for update;
    end if;
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
    perform 1 from public.partner_agencies where id = invitation.partner_agency_id and status = 'activo' ;
    if not found then return null; end if;
    -- Only the role actually authorized by this linked invitation is added to the case.
    if invitation.role = 'inquilino' then
      if operation.solicitud_inquilino_id is distinct from invitation.linked_record_id then return null; end if;
      select id into tenant_id from public.solicitudes_inquilino where id = invitation.linked_record_id and origen_operacion = 'partner' ;
      if tenant_id is null then return null; end if;
    elsif invitation.role = 'propietario' then
      if operation.propietario_id is distinct from invitation.linked_record_id then return null; end if;
      select id into owner_id from public.propietarios_inmuebles where id = invitation.linked_record_id and origen_operacion = 'partner' ;
      if owner_id is null then return null; end if;
    else return null;
    end if;
    select * into external_case from public.blindaje_external_cases where partner_operation_id = operation.id;

    if external_case.id is not null then
      perform 1 from public.blindaje_investigation_payments where case_id = external_case.id for update;
      select * into external_case from public.blindaje_external_cases where id = external_case.id for update;
    end if;
    if external_case.id is null then
      insert into public.blindaje_external_cases(origin_type,initiated_by_role,partner_operation_id,solicitud_inquilino_id,propietario_id)
      values ('partner',invitation.role,operation.id,tenant_id,owner_id) returning * into external_case;
    else
      if (tenant_id is not null and external_case.solicitud_inquilino_id is not null and external_case.solicitud_inquilino_id <> tenant_id)
        or (owner_id is not null and external_case.propietario_id is not null and external_case.propietario_id <> owner_id) then return null; end if;
      update public.blindaje_external_cases set solicitud_inquilino_id = coalesce(solicitud_inquilino_id,tenant_id),
        propietario_id = coalesce(propietario_id,owner_id), updated_at = now() where id = external_case.id returning * into external_case;
    end if;
  else return null;
  end if;
  if external_case.status not in ('awaiting_payment','proof_received','payment_validated','payment_rejected') then return null; end if;
  insert into public.blindaje_investigation_payments(case_id) values (external_case.id) on conflict (case_id) do nothing;
  if external_case.status = 'payment_validated' then
    perform 1 from public.blindaje_investigation_payments p
      join public.blindaje_investigation_ledger_entries l on l.payment_id = p.id
      join public.poliza_caja c on c.id = l.poliza_caja_id
      where p.case_id = external_case.id and p.status = 'validated' and c.tipo = 'ingreso' and c.concepto = 'investigacion' and c.monto = 1000;
    if not found then raise exception 'Inconsistent payment' using errcode = '23514'; end if;
    update public.solicitudes_inquilino set cobro_investigacion = true,
      fecha_cobro_investigacion = (now() at time zone 'America/Mexico_City')::date,
      monto_investigacion = 1000, metodo_cobro_investigacion = 'transferencia'
      where id = external_case.solicitud_inquilino_id and cobro_investigacion is distinct from true;
  end if;
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
  select * into payment from public.blindaje_investigation_payments where case_id = access_token.case_id for update;
  if not found then return false; end if;
  select status into case_status from public.blindaje_external_cases where id = access_token.case_id for update;
  if case_status not in ('awaiting_payment','proof_received','payment_rejected') then return false; end if;
  if not found or payment.status not in ('pending','proof_received','rejected') or payment.proof_storage_path is distinct from p_expected_path then return false; end if;
  if p_payer_role is null or p_payer_role not in ('inquilino','propietario','tercero') or (p_payer_role = 'tercero' and coalesce(length(trim(p_payer_name)),0) = 0) then return false; end if;
  if p_mime is null or p_mime not in ('application/pdf','image/jpeg','image/png') or p_path is null or
    p_path !~ ('^cases/' || access_token.case_id::text || '/investigation/' || payment.id::text || '/[0-9a-f-]+\.(pdf|jpg|png)$') then return false; end if;
  update public.blindaje_investigation_payments set status = 'proof_received', rejection_reason = null, rejected_by = null, rejected_at = null, validated_by = null, validated_at = null, payer_role = p_payer_role,
    payer_name = case when p_payer_role = 'tercero' then trim(p_payer_name) else null end,
    proof_storage_path = p_path, proof_content_type = p_mime, proof_original_name = p_name,
    proof_submitted_at = now(), updated_at = now() where id = payment.id;
  update public.blindaje_external_cases set status = 'proof_received', updated_at = now() where id = access_token.case_id;
  return true;
end $$;

create function public.blindaje_review_investigation_payment(p_payment_id uuid, p_action text, p_actor_id uuid, p_actor_label text, p_rejection_reason text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  payment public.blindaje_investigation_payments;
  external_case public.blindaje_external_cases;
  income public.poliza_caja;
  income_id uuid;
  client_name text;
  local_date date := (now() at time zone 'America/Mexico_City')::date;
begin
  if p_action is null or p_action not in ('validate','reject') or p_actor_id is null or nullif(btrim(p_actor_label),'') is null then return null; end if;
  if p_action = 'reject' and (p_rejection_reason is null or length(btrim(p_rejection_reason)) not between 3 and 300) then return null; end if;
  select * into payment from public.blindaje_investigation_payments where id = p_payment_id for update;
  if not found then return null; end if;
  select * into external_case from public.blindaje_external_cases where id = payment.case_id for update;
  if not found then return null; end if;
  select c.* into income from public.blindaje_investigation_ledger_entries l join public.poliza_caja c on c.id = l.poliza_caja_id where l.payment_id = payment.id;
  if payment.status = 'validated' then
    if external_case.status <> 'payment_validated' or income.id is null or income.tipo <> 'ingreso' or income.concepto <> 'investigacion' or income.monto <> 1000 then
      raise exception 'Inconsistent payment' using errcode = '23514';
    end if;
    if p_action = 'validate' then return 'validated'; end if;
    return null;
  end if;
  if income.id is not null then raise exception 'Inconsistent payment' using errcode = '23514'; end if;
  if p_action = 'reject' and payment.status = 'rejected' and external_case.status = 'payment_rejected' then return 'rejected'; end if;
  if payment.status <> 'proof_received' or external_case.status <> 'proof_received' or payment.proof_storage_path is null or payment.amount <> 1000 then return null; end if;
  if p_action = 'reject' then
    update public.blindaje_investigation_payments set status = 'rejected', rejected_by = p_actor_id, rejected_at = now(), rejection_reason = btrim(p_rejection_reason), validated_by = null, validated_at = null, updated_at = now() where id = payment.id;
    update public.blindaje_external_cases set status = 'payment_rejected', updated_at = now() where id = external_case.id;
    return 'rejected';
  end if;
  select coalesce(nullif(nombre_completo,''),nullif(razon_social,'')) into client_name from public.solicitudes_inquilino where id = external_case.solicitud_inquilino_id;
  if client_name is null then select nullif(nombre_propietario,'') into client_name from public.propietarios_inmuebles where id = external_case.propietario_id; end if;
  insert into public.poliza_caja(tipo,concepto,monto,metodo_pago,fecha,descripcion,solicitud_id,nombre_cliente,creado_por)
    values ('ingreso','investigacion',1000,'transferencia',local_date,'Anticipo de investigación — ' || external_case.folio,external_case.solicitud_inquilino_id,coalesce(client_name,external_case.folio),p_actor_label) returning id into income_id;
  insert into public.blindaje_investigation_ledger_entries(payment_id,poliza_caja_id) values (payment.id,income_id);
  update public.blindaje_investigation_payments set status = 'validated', validated_by = p_actor_id, validated_at = now(), rejection_reason = null, rejected_by = null, rejected_at = null, updated_at = now() where id = payment.id;
  update public.blindaje_external_cases set status = 'payment_validated', updated_at = now() where id = external_case.id;
  update public.solicitudes_inquilino set cobro_investigacion = true, fecha_cobro_investigacion = local_date, monto_investigacion = 1000, metodo_cobro_investigacion = 'transferencia' where id = external_case.solicitud_inquilino_id;
  return 'validated';
end $$;
revoke all on function public.blindaje_review_investigation_payment(uuid,text,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.blindaje_review_investigation_payment(uuid,text,uuid,text,text) to service_role;

commit;
