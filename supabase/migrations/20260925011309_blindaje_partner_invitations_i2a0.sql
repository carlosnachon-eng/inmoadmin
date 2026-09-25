begin;
create table public.blindaje_partner_invitations (
  id uuid primary key default gen_random_uuid(),
  partner_agency_id uuid not null references public.partner_agencies(id),
  partner_operation_id uuid not null references public.partner_operations(id),
  role text not null check (role in ('inquilino','propietario')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- Once linked, retries cannot switch the submitted record.
  linked_record_id uuid
);
alter table public.blindaje_partner_invitations enable row level security;
revoke all on public.blindaje_partner_invitations from public, anon, authenticated;
grant select, insert, update, delete on public.blindaje_partner_invitations to service_role;
create index blindaje_invitations_operation_idx on public.blindaje_partner_invitations(partner_operation_id);
create index blindaje_invitations_agency_idx on public.blindaje_partner_invitations(partner_agency_id);
create index blindaje_invitations_expiry_idx on public.blindaje_partner_invitations(expires_at);
create index blindaje_invitations_creator_idx on public.blindaje_partner_invitations(created_by);

-- Server-only transaction. SECURITY INVOKER, no elevated public function.
create function public.blindaje_link_invited_submission(p_token_hash text, p_tipo text, p_record_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  invitation public.blindaje_partner_invitations%rowtype;
  operation public.partner_operations%rowtype;
  submitted_origin text;
  submitted_at timestamptz;
  current_record uuid;
begin
  select * into invitation from public.blindaje_partner_invitations
    where token_hash = p_token_hash for update;
  if not found or invitation.revoked_at is not null or invitation.expires_at <= clock_timestamp()
    or invitation.role is distinct from p_tipo then return false; end if;
  -- Serialize the check/update with concurrent invited links and legacy writes.
  lock table public.partner_operations in share row exclusive mode;
  select * into operation from public.partner_operations where id = invitation.partner_operation_id for update;
  if not found or operation.partner_agency_id <> invitation.partner_agency_id then return false; end if;
  perform 1 from public.partner_agencies where id = invitation.partner_agency_id and status = 'activo' for share;
  if not found then return false; end if;
  if invitation.linked_record_id is not null and invitation.linked_record_id <> p_record_id then return false; end if;
  if p_tipo = 'inquilino' then
    select origen_operacion, created_at into submitted_origin, submitted_at
      from public.solicitudes_inquilino where id = p_record_id for share;
    current_record := operation.solicitud_inquilino_id;
  elsif p_tipo = 'propietario' then
    select origen_operacion, created_at into submitted_origin, submitted_at
      from public.propietarios_inmuebles where id = p_record_id for share;
    current_record := operation.propietario_id;
  else return false;
  end if;
  if submitted_origin is distinct from 'partner' or submitted_at is null then return false; end if;
  if current_record is not null and current_record <> p_record_id then return false; end if;
  if exists (select 1 from public.partner_operations where id <> operation.id and
    ((p_tipo = 'inquilino' and solicitud_inquilino_id = p_record_id) or (p_tipo = 'propietario' and propietario_id = p_record_id)))
    then return false; end if;
  -- New links: at most 24h old and not predating this invitation (5 min clock tolerance).
  -- Identical successful retries remain valid for the lifetime of the invitation.
  if invitation.linked_record_id is null and (submitted_at < clock_timestamp() - interval '24 hours'
    or submitted_at < invitation.created_at - interval '5 minutes' or submitted_at > clock_timestamp() + interval '5 minutes')
    then return false; end if;
  if invitation.linked_record_id is not null and current_record = p_record_id then return true; end if;
  update public.partner_operations set
    solicitud_inquilino_id = case when p_tipo = 'inquilino' then p_record_id else solicitud_inquilino_id end,
    propietario_id = case when p_tipo = 'propietario' then p_record_id else propietario_id end,
    status_partner = case when (p_tipo = 'inquilino' and propietario_id is not null) or (p_tipo = 'propietario' and solicitud_inquilino_id is not null) then 'en_revision' else 'recibida' end,
    observaciones_publicas = case
      when (p_tipo = 'inquilino' and propietario_id is not null) or (p_tipo = 'propietario' and solicitud_inquilino_id is not null)
        then 'Solicitud del inquilino y registro del propietario recibidos. Emporio revisara la documentacion.'
      when p_tipo = 'inquilino' then 'Solicitud del inquilino recibida. Falta recibir el registro del propietario.'
      else 'Registro del propietario recibido. Falta recibir la solicitud del inquilino.' end,
    updated_at = now() where id = operation.id;
  update public.blindaje_partner_invitations set linked_record_id = p_record_id, last_used_at = now() where id = invitation.id;
  return true;
end;
$$;
revoke all on function public.blindaje_link_invited_submission(text,text,uuid) from public, anon, authenticated;
grant execute on function public.blindaje_link_invited_submission(text,text,uuid) to service_role;
commit;
