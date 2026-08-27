-- Portal condominal MVP: acceso explícito multiunidad y lectura separada de históricos/corriente.
-- No contiene PII, usuarios, correos, cuotas, Storage, documentos, gastos ni mantenimiento.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.condominium_operation_controls') is null
     or to_regclass('public.condominium_historical_accounts') is null
     or to_regclass('public.condominium_historical_payments') is null
     or to_regclass('public.condominios') is null
     or to_regclass('public.unidades_condominio') is null
     or to_regclass('public.cuotas_condominio') is null
     or to_regclass('public.gastos_condominio') is null
     or to_regclass('public.maintenance_tickets') is null
     or to_regprocedure('public.condominium_owner_portal_allowed(uuid)') is null
     or to_regprocedure('public.condominium_auth_email()') is null
     or to_regprocedure('public.condominium_internal_permission(text,boolean)') is null then
    raise exception 'Faltan dependencias del módulo condominal endurecido.';
  end if;
end $$;

create table public.condominium_unit_portal_access (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  unidad_id uuid not null references public.unidades_condominio(id) on delete restrict,
  email_normalized text not null check (
    email_normalized = lower(btrim(email_normalized))
    and email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  access_kind text not null default 'OWNER'
    check (access_kind in ('OWNER','COOWNER','AUTHORIZED_RESIDENT')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(id) on delete restrict,
  revoked_at timestamptz null,
  notes text null check (notes is null or length(notes) <= 500),
  unique (unidad_id,email_normalized),
  constraint condominium_unit_portal_access_active_check
    check ((active and revoked_at is null) or not active)
);

create index condominium_unit_portal_access_email_idx
on public.condominium_unit_portal_access(email_normalized,condominio_id,unidad_id)
where active;

create or replace function public.condominium_portal_access_scope_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists (
    select 1 from public.unidades_condominio u
    where u.id=new.unidad_id and u.condominio_id=new.condominio_id and u.activo=true
  ) then
    raise exception using errcode='23514',message='La unidad no pertenece al condominio indicado.';
  end if;
  return new;
end $$;

create trigger condominium_portal_access_scope_guard
before insert or update on public.condominium_unit_portal_access
for each row execute function public.condominium_portal_access_scope_guard();

alter table public.condominium_unit_portal_access enable row level security;
revoke all on public.condominium_unit_portal_access from public,anon,authenticated;
grant select,insert,update,delete on public.condominium_unit_portal_access to authenticated;
grant all privileges on public.condominium_unit_portal_access to service_role;

create policy condominium_unit_portal_access_internal_select
on public.condominium_unit_portal_access for select to authenticated
using (public.condominium_internal_permission('condominios',false));
create policy condominium_unit_portal_access_internal_insert
on public.condominium_unit_portal_access for insert to authenticated
with check (public.condominium_internal_permission('condominios',true));
create policy condominium_unit_portal_access_internal_update
on public.condominium_unit_portal_access for update to authenticated
using (public.condominium_internal_permission('condominios',true))
with check (public.condominium_internal_permission('condominios',true));
create policy condominium_unit_portal_access_internal_delete
on public.condominium_unit_portal_access for delete to authenticated
using (public.condominium_internal_permission('condominios',true));

create or replace function public.condominium_is_controlled(p_condominio_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.condominium_operation_controls o
    where o.condominio_id=p_condominio_id
  )
$$;

revoke all on function public.condominium_is_controlled(uuid) from public,anon;
grant execute on function public.condominium_is_controlled(uuid) to authenticated,service_role;

create or replace function public.condominium_owner_has_unit(p_condominio_id uuid,p_unidad_id uuid default null)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.condominium_owner_portal_allowed(p_condominio_id) and exists(
    select 1
    from public.unidades_condominio u
    where u.condominio_id=p_condominio_id and u.activo=true
      and (p_unidad_id is null or u.id=p_unidad_id)
      and public.condominium_auth_email()<>''
      and (
        (
          public.condominium_is_controlled(u.condominio_id)
          and exists(
            select 1 from public.condominium_unit_portal_access a
            where a.condominio_id=u.condominio_id and a.unidad_id=u.id
              and a.active=true and a.revoked_at is null
              and a.email_normalized=public.condominium_auth_email()
          )
        )
        or (
          not public.condominium_is_controlled(u.condominio_id)
          and (
            public.condominium_auth_email() in (
              lower(coalesce(u.propietario_email,'')),lower(coalesce(u.residente_email,''))
            )
            or exists(
              select 1 from public.condominium_unit_portal_access a
              where a.condominio_id=u.condominio_id and a.unidad_id=u.id
                and a.active=true and a.revoked_at is null
                and a.email_normalized=public.condominium_auth_email()
            )
          )
        )
      )
  )
$$;

revoke all on function public.condominium_owner_has_unit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.condominium_owner_has_unit(uuid,uuid) to authenticated,service_role;

-- El portal controlado es read-only. Los flujos de comprobantes, gastos y mantenimiento
-- se conservan únicamente para condominios legacy sin operation controls.
drop policy if exists cuotas_hardened_update on public.cuotas_condominio;
create policy cuotas_hardened_update on public.cuotas_condominio for update to authenticated using (
  public.condominium_internal_permission('condominios',true)
  or (
    not public.condominium_is_controlled(condominio_id)
    and public.condominium_owner_has_unit(condominio_id,unidad_id)
  )
) with check (
  public.condominium_internal_permission('condominios',true)
  or (
    not public.condominium_is_controlled(condominio_id)
    and public.condominium_owner_has_unit(condominio_id,unidad_id)
  )
);

drop policy if exists gastos_hardened_select on public.gastos_condominio;
create policy gastos_hardened_select on public.gastos_condominio for select to authenticated using (
  public.condominium_internal_permission('condominios',false)
  or (
    not public.condominium_is_controlled(condominio_id)
    and public.condominium_owner_has_unit(condominio_id,null)
  )
);

drop policy if exists maintenance_hardened_select on public.maintenance_tickets;
create policy maintenance_hardened_select on public.maintenance_tickets for select to authenticated using (
  public.condominium_internal_permission('mantenimiento',false)
  or (
    condominio_id is not null
    and not public.condominium_is_controlled(condominio_id)
    and public.condominium_owner_has_unit(condominio_id,null)
  )
  or (
    condominio_id is null and public.condominium_auth_email()<>'' and (
      exists(
        select 1 from public.contracts c
        where lower(coalesce(c.tenant_email,''))=public.condominium_auth_email()
          and c.status='activo' and c.property_name=maintenance_tickets.property_name
      )
      or exists(
        select 1 from public.properties p
        where lower(coalesce(p.owner_email,''))=public.condominium_auth_email()
          and p.name=maintenance_tickets.property_name
      )
    )
  )
);

create or replace function public.condominium_owner_portal_units()
returns table(
  unidad_id uuid,condominio_id uuid,unit_number text,condominium_name text,
  monthly_fee numeric,access_kind text,portal_mode text
)
language sql stable security definer set search_path=public,pg_temp as $$
  select u.id,u.condominio_id,u.numero,c.nombre,c.cuota_mensual,
    coalesce((
      select a.access_kind from public.condominium_unit_portal_access a
      where a.unidad_id=u.id and a.active=true and a.revoked_at is null
        and a.email_normalized=public.condominium_auth_email()
      order by a.created_at desc limit 1
    ),'LEGACY_EMAIL'),
    case when public.condominium_is_controlled(u.condominio_id)
      then 'CONTROLLED' else 'LEGACY' end
  from public.unidades_condominio u
  join public.condominios c on c.id=u.condominio_id
  where u.activo=true and public.condominium_owner_has_unit(u.condominio_id,u.id)
  order by c.nombre,u.numero
$$;

create or replace function public.condominium_owner_portal_snapshot(p_unidad_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  target record;
  result jsonb;
begin
  select u.id,u.condominio_id,u.numero,c.nombre,c.cuota_mensual
  into target
  from public.unidades_condominio u join public.condominios c on c.id=u.condominio_id
  where u.id=p_unidad_id and u.activo=true
    and public.condominium_owner_has_unit(u.condominio_id,u.id);
  if not found then raise exception using errcode='42501',message='Unidad no autorizada.'; end if;

  result:=jsonb_build_object(
    'unit',jsonb_build_object(
      'id',target.id,'number',target.numero,'condominiumId',target.condominio_id,
      'condominiumName',target.nombre,'monthlyFee',target.cuota_mensual
    ),
    'historical',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',h.id,'sourceOrganization',h.source_organization,'sourceLabel',h.source_label,
        'cutoffDate',h.cutoff_date,'reportedCharges',h.reported_charges,
        'reportedPayments',h.reported_payments,'reportedBalance',h.reported_balance,
        'reviewStatus',h.review_status,'validatedCharges',h.validated_charges,
        'validatedPayments',h.validated_payments,'validatedBalance',h.validated_balance
      ) order by h.cutoff_date desc)
      from public.condominium_historical_accounts h
      where h.condominio_id=target.condominio_id and h.unidad_id=target.id
    ),'[]'::jsonb),
    'historicalPayments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,'period',p.reported_period,'amount',p.reported_amount,
        'receivedBy',p.received_by,'sourceLabel',p.source_label,'reviewStatus',p.review_status
      ) order by p.reported_period nulls last,p.created_at)
      from public.condominium_historical_payments p
      where p.condominio_id=target.condominio_id and p.unidad_id=target.id
    ),'[]'::jsonb),
    'currentFees',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',q.id,'period',q.periodo,'amount',q.monto,'status',q.status,
        'dueDate',q.fecha_vencimiento,'paidAt',q.fecha_pago
      ) order by q.periodo desc)
      from public.cuotas_condominio q
      where q.condominio_id=target.condominio_id and q.unidad_id=target.id
    ),'[]'::jsonb)
  );
  return result;
end $$;

revoke all on function public.condominium_owner_portal_units() from public,anon;
revoke all on function public.condominium_owner_portal_snapshot(uuid) from public,anon;
grant execute on function public.condominium_owner_portal_units() to authenticated,service_role;
grant execute on function public.condominium_owner_portal_snapshot(uuid) to authenticated,service_role;

commit;
