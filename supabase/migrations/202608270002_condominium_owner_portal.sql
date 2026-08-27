-- Portal condominal reutilizable: acceso multiunidad, histórico separado y archivos privados.
-- Migración aditiva. No contiene PII, usuarios, correos, cuotas ni datos de Génova.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.condominium_operation_controls') is null
     or to_regclass('public.condominium_historical_accounts') is null
     or to_regprocedure('public.condominium_owner_has_unit(uuid,uuid)') is null then
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

create or replace function public.condominium_owner_has_unit(p_condominio_id uuid,p_unidad_id uuid default null)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.condominium_owner_portal_allowed(p_condominio_id) and exists(
    select 1
    from public.unidades_condominio u
    where u.condominio_id=p_condominio_id and u.activo=true
      and (p_unidad_id is null or u.id=p_unidad_id)
      and public.condominium_auth_email()<>''
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
$$;

create table public.condominium_owner_documents (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  unidad_id uuid null references public.unidades_condominio(id) on delete restrict,
  title text not null check (length(btrim(title)) between 2 and 160),
  category text not null default 'GENERAL'
    check (category in ('GENERAL','REGLAMENTO','ASAMBLEA','ESTADO_CUENTA','OTRO')),
  storage_path text not null unique check (
    storage_path ~ '^[0-9a-f-]{36}/(shared|[0-9a-f-]{36})/documents/[0-9a-f-]{36}/[^/]+$'
  ),
  visible_to_owners boolean not null default false,
  published_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  constraint condominium_owner_documents_visibility_check
    check (not visible_to_owners or published_at is not null)
);

create index condominium_owner_documents_visible_idx
on public.condominium_owner_documents(condominio_id,unidad_id,published_at desc)
where visible_to_owners;

create or replace function public.condominium_owner_document_scope_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.unidad_id is not null and not exists(
    select 1 from public.unidades_condominio u
    where u.id=new.unidad_id and u.condominio_id=new.condominio_id
  ) then
    raise exception using errcode='23514',message='El documento no corresponde al condominio indicado.';
  end if;
  if split_part(new.storage_path,'/',1)<>new.condominio_id::text then
    raise exception using errcode='23514',message='Ruta de documento fuera del condominio.';
  end if;
  if split_part(new.storage_path,'/',2)<>coalesce(new.unidad_id::text,'shared') then
    raise exception using errcode='23514',message='Ruta de documento fuera de alcance.';
  end if;
  return new;
end $$;

create trigger condominium_owner_document_scope_guard
before insert or update on public.condominium_owner_documents
for each row execute function public.condominium_owner_document_scope_guard();

alter table public.condominium_owner_documents enable row level security;
revoke all on public.condominium_owner_documents from public,anon,authenticated;
grant select,insert,update,delete on public.condominium_owner_documents to authenticated;
grant all privileges on public.condominium_owner_documents to service_role;

create policy condominium_owner_documents_internal_select
on public.condominium_owner_documents for select to authenticated
using (public.condominium_internal_permission('condominios',false));
create policy condominium_owner_documents_internal_write
on public.condominium_owner_documents for all to authenticated
using (public.condominium_internal_permission('condominios',true))
with check (public.condominium_internal_permission('condominios',true));

alter table public.cuotas_condominio
  add column if not exists owner_proof_storage_path text null,
  add column if not exists owner_receipt_storage_path text null;

alter table public.cuotas_condominio
  drop constraint if exists cuotas_owner_proof_storage_path_check,
  add constraint cuotas_owner_proof_storage_path_check check (
    owner_proof_storage_path is null
    or owner_proof_storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/fee-proof/[0-9a-f-]{36}/[^/]+$'
  ),
  drop constraint if exists cuotas_owner_receipt_storage_path_check,
  add constraint cuotas_owner_receipt_storage_path_check check (
    owner_receipt_storage_path is null
    or owner_receipt_storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/fee-receipt/[0-9a-f-]{36}/[^/]+$'
  );

create or replace function public.condominium_external_fee_update_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then return new; end if;
  if public.condominium_internal_permission('condominios',true) then return new; end if;
  if not public.condominium_owner_has_unit(old.condominio_id,old.unidad_id) then
    raise exception using errcode='42501',message='No autorizado para modificar esta cuota.';
  end if;
  if current_setting('app.condominium_owner_proof_rpc',true)='allowed'
     and new.id is not distinct from old.id
     and new.condominio_id is not distinct from old.condominio_id
     and new.unidad_id is not distinct from old.unidad_id
     and new.periodo is not distinct from old.periodo
     and new.monto is not distinct from old.monto
     and new.fecha_vencimiento is not distinct from old.fecha_vencimiento
     and new.fecha_pago is not distinct from old.fecha_pago
     and new.pagado_por is not distinct from old.pagado_por
     and new.forma_pago is not distinct from old.forma_pago
     and new.notas is not distinct from old.notas
     and new.comprobante_url is not distinct from old.comprobante_url
     and new.recibo_url is not distinct from old.recibo_url
     and new.owner_receipt_storage_path is not distinct from old.owner_receipt_storage_path
     and new.status='pendiente'
  then return new; end if;
  raise exception using errcode='42501',message='El portal sólo puede adjuntar un comprobante mediante el flujo autorizado.';
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'condominium-owner-private','condominium-owner-private',false,10485760,
  array['application/pdf','image/jpeg','image/png','image/webp']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.condominium_owner_portal_units()
returns table(
  unidad_id uuid,condominio_id uuid,unit_number text,condominium_name text,
  monthly_fee numeric,access_kind text
)
language sql stable security definer set search_path=public,pg_temp as $$
  select u.id,u.condominio_id,u.numero,c.nombre,c.cuota_mensual,
    coalesce((
      select a.access_kind from public.condominium_unit_portal_access a
      where a.unidad_id=u.id and a.active=true and a.revoked_at is null
        and a.email_normalized=public.condominium_auth_email()
      order by a.created_at desc limit 1
    ),'LEGACY_EMAIL')
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
  show_expenses boolean;
  result jsonb;
begin
  select u.id,u.condominio_id,u.numero,c.nombre,c.cuota_mensual
  into target
  from public.unidades_condominio u join public.condominios c on c.id=u.condominio_id
  where u.id=p_unidad_id and u.activo=true
    and public.condominium_owner_has_unit(u.condominio_id,u.id);
  if not found then raise exception using errcode='42501',message='Unidad no autorizada.'; end if;

  select coalesce(o.money_movements_enabled,true) into show_expenses
  from public.condominium_operation_controls o where o.condominio_id=target.condominio_id;
  if not found then show_expenses:=true; end if;

  result:=jsonb_build_object(
    'unit',jsonb_build_object('id',target.id,'number',target.numero,'condominiumId',target.condominio_id,'condominiumName',target.nombre,'monthlyFee',target.cuota_mensual),
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
        'dueDate',q.fecha_vencimiento,'paidAt',q.fecha_pago,
        'hasProof',q.owner_proof_storage_path is not null,
        'hasReceipt',q.owner_receipt_storage_path is not null
      ) order by q.periodo desc)
      from public.cuotas_condominio q
      where q.condominio_id=target.condominio_id and q.unidad_id=target.id
    ),'[]'::jsonb),
    'documents',coalesce((
      select jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'category',d.category,'publishedAt',d.published_at) order by d.published_at desc)
      from public.condominium_owner_documents d
      where d.condominio_id=target.condominio_id and d.visible_to_owners=true
        and (d.unidad_id is null or d.unidad_id=target.id)
    ),'[]'::jsonb),
    'expensesVisible',show_expenses,
    'expenses',case when show_expenses then coalesce((
      select jsonb_agg(jsonb_build_object('id',g.id,'concept',g.concepto,'category',g.categoria,'amount',g.monto,'date',g.fecha) order by g.fecha desc)
      from (select * from public.gastos_condominio where condominio_id=target.condominio_id order by fecha desc limit 20) g
    ),'[]'::jsonb) else '[]'::jsonb end
  );
  return result;
end $$;

create or replace function public.condominium_owner_attach_fee_proof(p_fee_id uuid,p_storage_path text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare fee record;
begin
  select q.id,q.condominio_id,q.unidad_id,q.status into fee
  from public.cuotas_condominio q where q.id=p_fee_id;
  if not found or not public.condominium_owner_has_unit(fee.condominio_id,fee.unidad_id) then
    raise exception using errcode='42501',message='Cuota no autorizada.';
  end if;
  if fee.status='pagado' then raise exception using errcode='55000',message='La cuota ya está pagada.'; end if;
  if p_storage_path !~ ('^'||fee.condominio_id::text||'/'||fee.unidad_id::text||'/fee-proof/'||fee.id::text||'/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$') then
    raise exception using errcode='23514',message='Ruta de comprobante inválida.';
  end if;
  perform set_config('app.condominium_owner_proof_rpc','allowed',true);
  update public.cuotas_condominio
  set owner_proof_storage_path=p_storage_path,status='pendiente'
  where id=fee.id;
end $$;

create or replace function public.condominium_owner_storage_path(p_kind text,p_record_id uuid)
returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result text;
begin
  if p_kind in ('fee-proof','fee-receipt') then
    select case when p_kind='fee-proof' then q.owner_proof_storage_path else q.owner_receipt_storage_path end
    into result from public.cuotas_condominio q
    where q.id=p_record_id and public.condominium_owner_has_unit(q.condominio_id,q.unidad_id);
  elsif p_kind='document' then
    select d.storage_path into result from public.condominium_owner_documents d
    where d.id=p_record_id and d.visible_to_owners=true
      and public.condominium_owner_has_unit(d.condominio_id,d.unidad_id);
    if result is null then
      select d.storage_path into result from public.condominium_owner_documents d
      where d.id=p_record_id and d.visible_to_owners=true and d.unidad_id is null
        and public.condominium_owner_has_unit(d.condominio_id,null);
    end if;
  else
    raise exception using errcode='22023',message='Tipo de archivo inválido.';
  end if;
  if result is null then raise exception using errcode='42501',message='Archivo no autorizado.'; end if;
  return result;
end $$;

revoke all on function public.condominium_owner_portal_units() from public,anon;
revoke all on function public.condominium_owner_portal_snapshot(uuid) from public,anon;
revoke all on function public.condominium_owner_attach_fee_proof(uuid,text) from public,anon;
revoke all on function public.condominium_owner_storage_path(text,uuid) from public,anon;
grant execute on function public.condominium_owner_portal_units() to authenticated,service_role;
grant execute on function public.condominium_owner_portal_snapshot(uuid) to authenticated,service_role;
grant execute on function public.condominium_owner_attach_fee_proof(uuid,text) to authenticated,service_role;
grant execute on function public.condominium_owner_storage_path(text,uuid) to authenticated,service_role;

commit;
