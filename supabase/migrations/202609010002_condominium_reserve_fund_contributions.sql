-- Fondo de Reserva independiente del mantenimiento condominal.
-- Un comprobante/depósito puede distribuirse entre una o varias unidades.
-- No contiene datos, propietarios, cuotas, pagos, saldos ni evidencias reales.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.condominios') is null
     or to_regclass('public.unidades_condominio') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.condominium_operation_controls') is null
     or to_regprocedure('public.condominium_internal_permission(text,boolean)') is null
     or to_regprocedure('gen_random_uuid()') is null
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Faltan dependencias del módulo condominal endurecido o Storage.';
  end if;

  if to_regclass('public.condominium_reserve_fund_receipts') is not null
     or to_regclass('public.condominium_reserve_fund_contributions') is not null
     or to_regprocedure('public.condominium_create_reserve_fund_receipt(uuid,uuid,jsonb,text,date,text,text,text,uuid)') is not null
     or to_regprocedure('public.condominium_reconcile_reserve_fund_receipt(uuid,date,text)') is not null
     or to_regprocedure('public.condominium_reverse_reserve_fund_receipt(uuid,text)') is not null then
    raise exception 'MIGRACION ABORTADA: ya existe soporte de Fondo de Reserva y requiere conciliación explícita.';
  end if;

  if exists(
    select 1 from storage.buckets b
    where b.id = 'condominium-reserve-fund-evidence'
      and (
        b.public is distinct from false
        or b.file_size_limit is distinct from 5242880
        or b.allowed_mime_types is distinct from array['application/pdf','image/jpeg','image/png']::text[]
      )
  ) then
    raise exception 'MIGRACION ABORTADA: el bucket de Fondo de Reserva existe con otra configuración.';
  end if;
end $$;

create table public.condominium_reserve_fund_receipts (
  id uuid primary key,
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  total_amount numeric(14,2) not null check (total_amount > 0),
  source_organization text not null check (length(btrim(source_organization)) between 2 and 160),
  proof_date date not null,
  deposit_date date null,
  payment_reference text not null check (length(btrim(payment_reference)) between 3 and 160),
  evidence_path text not null check (
    length(btrim(evidence_path)) between 10 and 500
    and evidence_path !~* '^https?://'
  ),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','reconciled','reversed')),
  bank_confirmed_by text null check (bank_confirmed_by is null or length(btrim(bank_confirmed_by)) between 2 and 160),
  reconciled_by uuid null references public.profiles(id) on delete restrict,
  reconciled_at timestamptz null,
  reversal_reason text null check (reversal_reason is null or length(btrim(reversal_reason)) between 5 and 1000),
  reversed_by uuid null references public.profiles(id) on delete restrict,
  reversed_at timestamptz null,
  idempotency_key uuid not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint condominium_reserve_fund_receipt_state_check check (
    (
      status = 'pending'
      and deposit_date is null and bank_confirmed_by is null
      and reconciled_by is null and reconciled_at is null
      and reversal_reason is null and reversed_by is null and reversed_at is null
    )
    or (
      status = 'reconciled'
      and deposit_date is not null and bank_confirmed_by is not null
      and reconciled_by is not null and reconciled_at is not null
      and reversal_reason is null and reversed_by is null and reversed_at is null
    )
    or (
      status = 'reversed'
      and deposit_date is not null and bank_confirmed_by is not null
      and reconciled_by is not null and reconciled_at is not null
      and reversal_reason is not null and reversed_by is not null and reversed_at is not null
    )
  ),
  constraint condominium_reserve_fund_receipt_idempotency_unique unique (condominio_id, idempotency_key),
  constraint condominium_reserve_fund_receipt_evidence_unique unique (condominio_id, evidence_sha256)
);

create table public.condominium_reserve_fund_contributions (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.condominium_reserve_fund_receipts(id) on delete restrict,
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  unidad_id uuid not null references public.unidades_condominio(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  constraint condominium_reserve_fund_receipt_unit_unique unique (receipt_id, unidad_id)
);

comment on table public.condominium_reserve_fund_receipts is
  'Comprobantes privados de Fondo de Reserva. Se concilian y revierten como una sola operación bancaria.';
comment on table public.condominium_reserve_fund_contributions is
  'Aplicaciones por unidad de un comprobante de Fondo de Reserva; no forman parte de cuotas, cartera histórica, recuperaciones, gastos ni KPI.';
comment on column public.condominium_reserve_fund_receipts.evidence_path is
  'Ruta privada en Storage; nunca una URL pública.';

create index condominium_reserve_fund_receipt_scope_status_idx
on public.condominium_reserve_fund_receipts(condominio_id, status, proof_date desc);
create index condominium_reserve_fund_contribution_unit_idx
on public.condominium_reserve_fund_contributions(condominio_id, unidad_id, created_at desc);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'condominium-reserve-fund-evidence',
  'condominium-reserve-fund-evidence',
  false,
  5242880,
  array['application/pdf','image/jpeg','image/png']::text[]
)
on conflict (id) do nothing;

-- Sin policies de Storage para clientes. La carga y URL firmada pasan por el
-- endpoint server-side después de autorizar al operador.

create function public.condominium_reserve_fund_receipt_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Los comprobantes de Fondo de Reserva no pueden eliminarse.';
  end if;
  if new.evidence_path !~ ('^' || new.condominio_id::text || '/' || new.id::text || '[.](pdf|jpg|jpeg|png)$') then
    raise exception using errcode = '23514', message = 'La evidencia no corresponde al comprobante y condominio.';
  end if;
  if tg_op = 'INSERT' and new.status <> 'pending' then
    raise exception using errcode = '23514', message = 'Un comprobante nuevo debe iniciar pendiente.';
  end if;
  if tg_op = 'UPDATE' then
    if old.condominio_id is distinct from new.condominio_id
       or old.total_amount is distinct from new.total_amount
       or old.source_organization is distinct from new.source_organization
       or old.proof_date is distinct from new.proof_date
       or old.payment_reference is distinct from new.payment_reference
       or old.evidence_path is distinct from new.evidence_path
       or old.evidence_sha256 is distinct from new.evidence_sha256
       or old.idempotency_key is distinct from new.idempotency_key
       or old.created_by is distinct from new.created_by
       or old.created_at is distinct from new.created_at then
      raise exception using errcode = '42501', message = 'Los datos fuente del comprobante son inmutables.';
    end if;
    if not (
      (old.status = 'pending' and new.status = 'reconciled')
      or (old.status = 'reconciled' and new.status = 'reversed')
    ) then
      raise exception using errcode = '23514', message = 'Transición de Fondo de Reserva no permitida.';
    end if;
    if old.status = 'reconciled' and (
      old.deposit_date is distinct from new.deposit_date
      or old.bank_confirmed_by is distinct from new.bank_confirmed_by
      or old.reconciled_by is distinct from new.reconciled_by
      or old.reconciled_at is distinct from new.reconciled_at
    ) then
      raise exception using errcode = '42501', message = 'La conciliación confirmada es inmutable.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create function public.condominium_reserve_fund_contribution_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare receipt_scope record;
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception using errcode = '42501', message = 'Las aplicaciones del Fondo de Reserva son inmutables.';
  end if;
  select r.condominio_id, r.status into receipt_scope
  from public.condominium_reserve_fund_receipts r where r.id = new.receipt_id;
  if not found or receipt_scope.status <> 'pending' or receipt_scope.condominio_id is distinct from new.condominio_id then
    raise exception using errcode = '23514', message = 'El comprobante no admite esta aplicación.';
  end if;
  if not exists(
    select 1 from public.unidades_condominio u
    where u.id = new.unidad_id and u.condominio_id = new.condominio_id and u.activo = true
  ) then
    raise exception using errcode = '23514', message = 'La unidad no corresponde al condominio o está inactiva.';
  end if;
  return new;
end;
$$;

create trigger condominium_reserve_fund_receipt_operation_guard
before insert or update or delete on public.condominium_reserve_fund_receipts
for each row execute function public.condominium_reserve_fund_receipt_guard();
create trigger condominium_reserve_fund_contribution_operation_guard
before insert or update or delete on public.condominium_reserve_fund_contributions
for each row execute function public.condominium_reserve_fund_contribution_guard();

create function public.condominium_create_reserve_fund_receipt(
  p_receipt_id uuid,
  p_condominio_id uuid,
  p_allocations jsonb,
  p_source_organization text,
  p_proof_date date,
  p_payment_reference text,
  p_evidence_path text,
  p_evidence_sha256 text,
  p_idempotency_key uuid
)
returns public.condominium_reserve_fund_receipts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result public.condominium_reserve_fund_receipts%rowtype;
  allocation_count integer;
  allocation_total numeric(14,2);
  normalized_input jsonb;
  normalized_existing jsonb;
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios', true) then
    raise exception using errcode = '42501', message = 'Operación no autorizada.';
  end if;
  if p_receipt_id is null or p_idempotency_key is null
     or jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) < 1 or jsonb_array_length(p_allocations) > 100
     or length(btrim(coalesce(p_source_organization, ''))) < 2
     or p_proof_date is null
     or length(btrim(coalesce(p_payment_reference, ''))) < 3
     or length(btrim(coalesce(p_evidence_path, ''))) < 10
     or coalesce(p_evidence_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Datos de Fondo de Reserva incompletos.';
  end if;

  select count(*), coalesce(sum(x.amount),0),
         jsonb_agg(jsonb_build_object('unidad_id', x.unidad_id::text, 'amount', x.amount) order by x.unidad_id)
  into allocation_count, allocation_total, normalized_input
  from jsonb_to_recordset(p_allocations) as x(unidad_id uuid, amount numeric)
  where x.unidad_id is not null and x.amount > 0;
  if allocation_count <> jsonb_array_length(p_allocations)
     or allocation_total <= 0
     or (select count(distinct x.unidad_id) from jsonb_to_recordset(p_allocations) as x(unidad_id uuid, amount numeric)) <> allocation_count then
    raise exception using errcode = '22023', message = 'Las aplicaciones por unidad son inválidas o están duplicadas.';
  end if;
  if (
    select count(*) from public.unidades_condominio u
    join jsonb_to_recordset(p_allocations) as x(unidad_id uuid, amount numeric) on x.unidad_id = u.id
    where u.condominio_id = p_condominio_id and u.activo = true
  ) <> allocation_count then
    raise exception using errcode = '23514', message = 'Existe una unidad fuera de alcance.';
  end if;

  select * into result
  from public.condominium_reserve_fund_receipts r
  where r.condominio_id = p_condominio_id and r.idempotency_key = p_idempotency_key;
  if found then
    select jsonb_agg(jsonb_build_object('unidad_id', c.unidad_id::text, 'amount', c.amount) order by c.unidad_id)
    into normalized_existing
    from public.condominium_reserve_fund_contributions c where c.receipt_id = result.id;
    if result.total_amount = allocation_total
       and result.source_organization = btrim(p_source_organization)
       and result.proof_date = p_proof_date
       and result.payment_reference = btrim(p_payment_reference)
       and result.evidence_path = btrim(p_evidence_path)
       and result.evidence_sha256 = p_evidence_sha256
       and normalized_existing = normalized_input then return result; end if;
    raise exception using errcode = '23505', message = 'La clave de idempotencia ya fue utilizada con otros datos.';
  end if;

  insert into public.condominium_reserve_fund_receipts(
    id, condominio_id, total_amount, source_organization, proof_date,
    payment_reference, evidence_path, evidence_sha256, status, idempotency_key, created_by
  ) values (
    p_receipt_id, p_condominio_id, allocation_total, btrim(p_source_organization), p_proof_date,
    btrim(p_payment_reference), btrim(p_evidence_path), p_evidence_sha256, 'pending', p_idempotency_key, auth.uid()
  ) returning * into result;
  insert into public.condominium_reserve_fund_contributions(receipt_id, condominio_id, unidad_id, amount)
  select result.id, p_condominio_id, x.unidad_id, x.amount
  from jsonb_to_recordset(p_allocations) as x(unidad_id uuid, amount numeric);
  return result;
exception
  when unique_violation then
    select * into result
    from public.condominium_reserve_fund_receipts r
    where r.condominio_id = p_condominio_id and r.idempotency_key = p_idempotency_key;
    if found then
      select jsonb_agg(jsonb_build_object('unidad_id', c.unidad_id::text, 'amount', c.amount) order by c.unidad_id)
      into normalized_existing
      from public.condominium_reserve_fund_contributions c where c.receipt_id = result.id;
      if result.total_amount = allocation_total
         and result.source_organization = btrim(p_source_organization)
         and result.proof_date = p_proof_date
         and result.payment_reference = btrim(p_payment_reference)
         and result.evidence_path = btrim(p_evidence_path)
         and result.evidence_sha256 = p_evidence_sha256
         and normalized_existing = normalized_input then return result; end if;
    end if;
    raise;
end;
$$;

create function public.condominium_reconcile_reserve_fund_receipt(
  p_receipt_id uuid,
  p_deposit_date date,
  p_bank_confirmed_by text
)
returns public.condominium_reserve_fund_receipts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  receipt public.condominium_reserve_fund_receipts%rowtype;
  controls public.condominium_operation_controls%rowtype;
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios', true) then
    raise exception using errcode = '42501', message = 'Operación no autorizada.';
  end if;
  if p_deposit_date is null or length(btrim(coalesce(p_bank_confirmed_by, ''))) < 2 then
    raise exception using errcode = '22023', message = 'La confirmación bancaria está incompleta.';
  end if;
  select * into receipt from public.condominium_reserve_fund_receipts r where r.id = p_receipt_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Comprobante no encontrado.'; end if;
  if receipt.status <> 'pending' then raise exception using errcode = '23514', message = 'El comprobante ya no está pendiente.'; end if;
  select * into controls from public.condominium_operation_controls c where c.condominio_id = receipt.condominio_id;
  if found and not controls.real_payments_enabled then
    raise exception using errcode = '55000', message = 'La confirmación de pagos reales está bloqueada.';
  end if;
  update public.condominium_reserve_fund_receipts
  set status = 'reconciled', deposit_date = p_deposit_date,
      bank_confirmed_by = btrim(p_bank_confirmed_by), reconciled_by = auth.uid(), reconciled_at = now()
  where id = receipt.id returning * into receipt;
  return receipt;
end;
$$;

create function public.condominium_reverse_reserve_fund_receipt(p_receipt_id uuid, p_reason text)
returns public.condominium_reserve_fund_receipts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare receipt public.condominium_reserve_fund_receipts%rowtype;
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios', true) then
    raise exception using errcode = '42501', message = 'Operación no autorizada.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception using errcode = '22023', message = 'El motivo de reversión es obligatorio.';
  end if;
  select * into receipt from public.condominium_reserve_fund_receipts r where r.id = p_receipt_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Comprobante no encontrado.'; end if;
  if receipt.status <> 'reconciled' then
    raise exception using errcode = '23514', message = 'Sólo puede revertirse un comprobante conciliado.';
  end if;
  update public.condominium_reserve_fund_receipts
  set status = 'reversed', reversal_reason = btrim(p_reason), reversed_by = auth.uid(), reversed_at = now()
  where id = receipt.id returning * into receipt;
  return receipt;
end;
$$;

alter table public.condominium_reserve_fund_receipts enable row level security;
alter table public.condominium_reserve_fund_receipts force row level security;
alter table public.condominium_reserve_fund_contributions enable row level security;
alter table public.condominium_reserve_fund_contributions force row level security;

create policy condominium_reserve_fund_receipt_internal_select
on public.condominium_reserve_fund_receipts for select to authenticated
using (public.condominium_internal_permission('condominios', false));
create policy condominium_reserve_fund_contribution_internal_select
on public.condominium_reserve_fund_contributions for select to authenticated
using (public.condominium_internal_permission('condominios', false));

revoke all on table public.condominium_reserve_fund_receipts from public, anon, authenticated, service_role;
revoke all on table public.condominium_reserve_fund_contributions from public, anon, authenticated, service_role;
grant select on table public.condominium_reserve_fund_receipts to authenticated, service_role;
grant select on table public.condominium_reserve_fund_contributions to authenticated, service_role;

revoke all on function public.condominium_reserve_fund_receipt_guard() from public, anon, authenticated, service_role;
revoke all on function public.condominium_reserve_fund_contribution_guard() from public, anon, authenticated, service_role;
revoke all on function public.condominium_create_reserve_fund_receipt(uuid,uuid,jsonb,text,date,text,text,text,uuid) from public, anon, service_role;
revoke all on function public.condominium_reconcile_reserve_fund_receipt(uuid,date,text) from public, anon, service_role;
revoke all on function public.condominium_reverse_reserve_fund_receipt(uuid,text) from public, anon, service_role;
grant execute on function public.condominium_create_reserve_fund_receipt(uuid,uuid,jsonb,text,date,text,text,text,uuid) to authenticated;
grant execute on function public.condominium_reconcile_reserve_fund_receipt(uuid,date,text) to authenticated;
grant execute on function public.condominium_reverse_reserve_fund_receipt(uuid,text) to authenticated;

commit;
