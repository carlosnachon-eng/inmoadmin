-- Cleanup mínimo y auditable para identidades creadas por onboarding condominal.
-- No crea usuarios, relaciones de portal ni PII.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$
begin
  if to_regclass('auth.users') is null
     or to_regclass('auth.sessions') is null
     or to_regclass('auth.refresh_tokens') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.roles') is null
     or to_regclass('public.permisos_modulo') is null
     or to_regclass('public.partner_users') is null
     or to_regclass('public.condominium_access_memberships') is null
     or to_regclass('public.condominium_unit_portal_access') is null
     or to_regclass('public.unidades_condominio') is null
     or to_regclass('public.condominium_operation_controls') is null then
    raise exception 'Faltan dependencias para cleanup de onboarding condominal.';
  end if;
end $$;

create table public.condominium_owner_onboarding_cleanup_audit (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  onboarding_attempt_id uuid not null,
  operator_id uuid null,
  result_code text not null,
  reason_code text not null,
  occurred_at timestamptz not null default now(),
  constraint condominium_owner_cleanup_result_check check (
    result_code in ('PROFILE_DELETED','PROFILE_ALREADY_ABSENT','ALREADY_COMPLETE','BLOCKED')
  ),
  constraint condominium_owner_cleanup_reason_length check (length(reason_code) between 1 and 80)
);

alter table public.condominium_owner_onboarding_cleanup_audit enable row level security;
revoke all on public.condominium_owner_onboarding_cleanup_audit from public,anon,authenticated;
grant select on public.condominium_owner_onboarding_cleanup_audit to service_role;

create or replace function public.cleanup_condominium_owner_onboarding_profile(
  p_auth_user_id uuid,
  p_onboarding_attempt_id uuid,
  p_operator_id uuid,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user auth.users%rowtype;
  v_profile public.profiles%rowtype;
  v_block_reason text;
  v_result text;
begin
  if p_auth_user_id is null or p_onboarding_attempt_id is null
     or p_operator_id is null or coalesce(length(p_reason_code),0) not between 1 and 80 then
    return jsonb_build_object('result_code','BLOCKED','reason_code','INVALID_REQUEST');
  end if;

  if not exists (
    select 1 from public.profiles p
    join public.roles r on r.id=p.role_id
    where p.id=p_operator_id and p.active=true and r.es_externo=false
      and (
        p.role_id='admin'
        or exists (
          select 1 from public.permisos_modulo pm
          where pm.role_id=p.role_id and pm.modulo='condominios'
            and pm.puede_ver=true and pm.puede_editar=true
        )
      )
  ) then
    return jsonb_build_object('result_code','BLOCKED','reason_code','OPERATOR_NOT_AUTHORIZED');
  end if;

  select * into v_user from auth.users where id=p_auth_user_id for update;
  select * into v_profile from public.profiles where id=p_auth_user_id for update;

  if not found and v_user.id is null and v_profile.id is null then
    v_result:='ALREADY_COMPLETE';
  elsif v_user.id is null then
    v_result:='BLOCKED'; v_block_reason:='AUTH_IDENTITY_MISSING';
  elsif coalesce(v_user.raw_app_meta_data->>'identity_type','')<>'condominium_owner'
     or coalesce(v_user.raw_app_meta_data->>'onboarding_attempt_id','')<>p_onboarding_attempt_id::text
     or coalesce(v_user.raw_user_meta_data->>'rol_pretendido','')<>'propietario' then
    v_result:='BLOCKED'; v_block_reason:='ONBOARDING_MARKER_MISMATCH';
  elsif v_user.last_sign_in_at is not null
     or exists(select 1 from auth.sessions s where s.user_id=p_auth_user_id)
     or exists(select 1 from auth.refresh_tokens rt where rt.user_id=p_auth_user_id::text) then
    v_result:='BLOCKED'; v_block_reason:='IDENTITY_ALREADY_USED';
  elsif exists(select 1 from public.partner_users pu where pu.auth_user_id=p_auth_user_id) then
    v_result:='BLOCKED'; v_block_reason:='PARTNER_ACCESS_PRESENT';
  elsif exists(select 1 from public.condominium_access_memberships m where m.principal_user_id=p_auth_user_id) then
    v_result:='BLOCKED'; v_block_reason:='MEMBERSHIP_PRESENT';
  elsif exists(
    select 1 from public.condominium_unit_portal_access a
    where a.email_normalized=lower(btrim(v_user.email))
  ) then
    v_result:='BLOCKED'; v_block_reason:='PORTAL_ACCESS_PRESENT';
  elsif exists(
    select 1 from public.unidades_condominio u
    left join public.condominium_operation_controls c on c.condominio_id=u.condominio_id
    where u.activo=true and c.condominio_id is null
      and (lower(btrim(u.propietario_email))=lower(btrim(v_user.email))
        or lower(btrim(u.residente_email))=lower(btrim(v_user.email)))
  ) then
    v_result:='BLOCKED'; v_block_reason:='LEGACY_ACCESS_PRESENT';
  elsif v_profile.id is null then
    v_result:='PROFILE_ALREADY_ABSENT';
  elsif v_profile.role_id<>'propietario' or v_profile.active is distinct from true
     or not exists(select 1 from public.roles r where r.id=v_profile.role_id and r.es_externo=true) then
    v_result:='BLOCKED'; v_block_reason:='PROFILE_NOT_EXTERNAL_OWNER';
  elsif exists(select 1 from public.permisos_modulo pm where pm.role_id=v_profile.role_id and (pm.puede_ver or pm.puede_editar)) then
    v_result:='BLOCKED'; v_block_reason:='INTERNAL_PERMISSIONS_PRESENT';
  else
    -- La función privilegiada elimina únicamente el perfil temporal validado.
    -- La identidad Auth se elimina después mediante Admin API y sólo si este
    -- resultado confirma que no existe ningún acceso o actividad previa.
    delete from public.profiles where id=p_auth_user_id;
    v_result:='PROFILE_DELETED';
  end if;

  insert into public.condominium_owner_onboarding_cleanup_audit(
    auth_user_id,onboarding_attempt_id,operator_id,result_code,reason_code
  ) values(
    p_auth_user_id,p_onboarding_attempt_id,p_operator_id,v_result,
    coalesce(v_block_reason,p_reason_code)
  );

  return jsonb_build_object('result_code',v_result,'reason_code',coalesce(v_block_reason,p_reason_code));
end;
$$;

alter function public.cleanup_condominium_owner_onboarding_profile(uuid,uuid,uuid,text)
owner to postgres;

revoke all on function public.cleanup_condominium_owner_onboarding_profile(uuid,uuid,uuid,text)
from public,anon,authenticated;
grant execute on function public.cleanup_condominium_owner_onboarding_profile(uuid,uuid,uuid,text)
to service_role;

commit;
