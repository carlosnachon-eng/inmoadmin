begin;

create sequence public.blindaje_external_folio_seq;
create table public.blindaje_external_cases (
  id uuid primary key default gen_random_uuid(),
  folio text unique not null default ('BL-' || extract(year from current_date)::text || '-' || lpad(nextval('public.blindaje_external_folio_seq')::text, 6, '0')),
  origin_type text not null check (origin_type in ('b2c','partner')),
  initiated_by_role text not null check (initiated_by_role in ('inquilino','propietario')),
  partner_operation_id uuid references public.partner_operations(id),
  solicitud_inquilino_id uuid references public.solicitudes_inquilino(id),
  propietario_id uuid references public.propietarios_inmuebles(id),
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment','proof_received','payment_validated','payment_rejected','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((origin_type = 'partner') = (partner_operation_id is not null))
);
create unique index blindaje_external_operation_unique on public.blindaje_external_cases(partner_operation_id) where partner_operation_id is not null;
create unique index blindaje_external_tenant_unique on public.blindaje_external_cases(solicitud_inquilino_id) where solicitud_inquilino_id is not null;
create unique index blindaje_external_owner_unique on public.blindaje_external_cases(propietario_id) where propietario_id is not null;

create table public.blindaje_investigation_payments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.blindaje_external_cases(id),
  amount numeric not null default 1000 check (amount = 1000),
  payer_role text check (payer_role in ('inquilino','propietario','tercero')), payer_name text,
  status text not null default 'pending' check (status in ('pending','proof_received','validated','rejected')),
  proof_storage_path text, proof_content_type text, proof_original_name text, proof_submitted_at timestamptz,
  validated_by uuid, validated_at timestamptz, rejection_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.blindaje_case_access_tokens (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references public.blindaje_external_cases(id),
  purpose text not null default 'payment' check (purpose = 'payment'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null, revoked_at timestamptz,
  created_at timestamptz not null default now(), last_used_at timestamptz
);
create index blindaje_payment_tokens_case_idx on public.blindaje_case_access_tokens(case_id);
create table public.blindaje_b2c_submission_tokens (
  id uuid primary key default gen_random_uuid(), role text not null check (role in ('inquilino','propietario')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now()
);

alter table public.solicitudes_inquilino add column blindaje_submission_claim_hash text check (blindaje_submission_claim_hash ~ '^[0-9a-f]{64}$');
alter table public.propietarios_inmuebles add column blindaje_submission_claim_hash text check (blindaje_submission_claim_hash ~ '^[0-9a-f]{64}$');
create unique index blindaje_tenant_claim_unique on public.solicitudes_inquilino(blindaje_submission_claim_hash) where blindaje_submission_claim_hash is not null;
create unique index blindaje_owner_claim_unique on public.propietarios_inmuebles(blindaje_submission_claim_hash) where blindaje_submission_claim_hash is not null;

-- Only this new column is immutable to browser roles; existing form permissions are untouched.
create function public.blindaje_preserve_submission_claim() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon','authenticated') and new.blindaje_submission_claim_hash is distinct from old.blindaje_submission_claim_hash then
    raise exception 'Submission claim is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger blindaje_preserve_claim before update of blindaje_submission_claim_hash on public.solicitudes_inquilino for each row execute function public.blindaje_preserve_submission_claim();
create trigger blindaje_preserve_claim before update of blindaje_submission_claim_hash on public.propietarios_inmuebles for each row execute function public.blindaje_preserve_submission_claim();

-- One transaction owns the trust check, identity, payment and access-token issuance.
create function public.blindaje_bootstrap_external_payment(p_kind text, p_hash text, p_role text, p_payment_hash text)
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

-- Compare-and-swap prevents concurrent replacements from orphaning the current proof.
create function public.blindaje_receive_payment_proof(p_hash text, p_expected_path text, p_path text, p_mime text, p_name text, p_payer_role text, p_payer_name text)
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

alter table public.blindaje_external_cases enable row level security;
alter table public.blindaje_investigation_payments enable row level security;
alter table public.blindaje_case_access_tokens enable row level security;
alter table public.blindaje_b2c_submission_tokens enable row level security;
revoke all on public.blindaje_external_cases, public.blindaje_investigation_payments, public.blindaje_case_access_tokens, public.blindaje_b2c_submission_tokens from public, anon, authenticated, service_role;
grant select, insert, update on public.blindaje_external_cases, public.blindaje_investigation_payments, public.blindaje_case_access_tokens, public.blindaje_b2c_submission_tokens to service_role;
revoke all on sequence public.blindaje_external_folio_seq from public, anon, authenticated, service_role;
grant usage on sequence public.blindaje_external_folio_seq to service_role;
revoke all on function public.blindaje_preserve_submission_claim() from public, anon, authenticated, service_role;
revoke all on function public.blindaje_bootstrap_external_payment(text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.blindaje_receive_payment_proof(text,text,text,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.blindaje_bootstrap_external_payment(text,text,text,text), public.blindaje_receive_payment_proof(text,text,text,text,text,text,text) to service_role;

-- No storage.objects policy is added. Server uploads exclusively with service_role.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('blindaje-payment-proofs','blindaje-payment-proofs',false,5242880,array['application/pdf','image/jpeg','image/png']);
commit;
