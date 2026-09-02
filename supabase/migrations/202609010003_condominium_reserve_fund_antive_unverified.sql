-- Fondo de Reserva: recepción histórica confirmada por Antive sin inventar evidencia bancaria.
-- Evolución aditiva; no importa registros reales ni modifica cuotas, cartera, recuperaciones, gastos o KPI.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  status_constraint text;
begin
  if to_regclass('public.condominium_reserve_fund_receipts') is null
     or to_regclass('public.condominium_reserve_fund_contributions') is null
     or to_regprocedure('public.condominium_create_reserve_fund_receipt(uuid,uuid,jsonb,text,date,text,text,text,uuid)') is null
     or to_regprocedure('public.condominium_reconcile_reserve_fund_receipt(uuid,date,text)') is null
     or to_regprocedure('public.condominium_reverse_reserve_fund_receipt(uuid,text)') is null then
    raise exception 'MIGRACION ABORTADA: falta el módulo base certificado de Fondo de Reserva.';
  end if;

  if to_regclass('public.condominium_reserve_fund_import_batches') is not null
     or exists(
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'condominium_reserve_fund_receipts'
         and column_name = 'record_kind'
     ) then
    raise exception 'MIGRACION ABORTADA: la extensión Antive ya existe o requiere conciliación explícita.';
  end if;

  select pg_get_constraintdef(c.oid) into status_constraint
  from pg_constraint c
  where c.conrelid = 'public.condominium_reserve_fund_receipts'::regclass
    and c.conname = 'condominium_reserve_fund_receipt_state_check';
  if status_constraint is null
     or status_constraint not like '%pending%'
     or status_constraint not like '%reconciled%'
     or status_constraint not like '%reversed%' then
    raise exception 'MIGRACION ABORTADA: baseline inesperado de estados de Fondo de Reserva.';
  end if;
end $$;

create table public.condominium_reserve_fund_import_batches (
  id uuid primary key,
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  source_organization text not null check (upper(btrim(source_organization)) = 'ANTIVE'),
  source_file_sha256 text not null check (source_file_sha256 ~ '^[a-f0-9]{64}$'),
  source_sheet text not null check (length(btrim(source_sheet)) between 1 and 160),
  received_confirmed_by text not null check (length(btrim(received_confirmed_by)) between 2 and 160),
  received_confirmed_at timestamptz not null,
  received_confirmation_note text null check (
    received_confirmation_note is null or length(btrim(received_confirmation_note)) between 1 and 1000
  ),
  status text not null default 'active' check (status in ('active','voided')),
  void_reason text null check (void_reason is null or length(btrim(void_reason)) between 5 and 1000),
  voided_by uuid null references public.profiles(id) on delete restrict,
  voided_at timestamptz null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint condominium_reserve_fund_batch_state_check check (
    (status = 'active' and void_reason is null and voided_by is null and voided_at is null)
    or (status = 'voided' and void_reason is not null and voided_by is not null and voided_at is not null)
  )
);

alter table public.condominium_reserve_fund_receipts
  drop constraint condominium_reserve_fund_receipt_state_check,
  drop constraint condominium_reserve_fund_receipts_status_check,
  alter column proof_date drop not null,
  alter column payment_reference drop not null,
  alter column evidence_path drop not null,
  alter column evidence_sha256 drop not null,
  add column record_kind text not null default 'bank_receipt',
  add column import_batch_id uuid null references public.condominium_reserve_fund_import_batches(id) on delete restrict,
  add column source_file_sha256 text null,
  add column source_sheet text null,
  add column source_range text null,
  add column source_unit_id uuid null references public.unidades_condominio(id) on delete restrict,
  add column received_confirmed_by text null,
  add column received_confirmed_at timestamptz null,
  add column received_confirmation_note text null,
  add column evidence_enriched_by uuid null references public.profiles(id) on delete restrict,
  add column evidence_enriched_at timestamptz null,
  add column void_reason text null,
  add column voided_by uuid null references public.profiles(id) on delete restrict,
  add column voided_at timestamptz null,
  add constraint condominium_reserve_fund_receipts_record_kind_check
    check (record_kind in ('bank_receipt','antive_historical_report')),
  add constraint condominium_reserve_fund_receipts_status_check
    check (status in ('received_by_antive_unverified','pending','reconciled','reversed','voided')),
  add constraint condominium_reserve_fund_receipt_evidence_complete_check check (
    (proof_date is null and payment_reference is null and evidence_path is null and evidence_sha256 is null)
    or (proof_date is not null and payment_reference is not null and evidence_path is not null and evidence_sha256 is not null)
  ),
  add constraint condominium_reserve_fund_receipt_source_check check (
    (
      record_kind = 'bank_receipt'
      and import_batch_id is null and source_file_sha256 is null and source_sheet is null
      and source_range is null and source_unit_id is null
      and received_confirmed_by is null and received_confirmed_at is null
      and received_confirmation_note is null and evidence_enriched_by is null and evidence_enriched_at is null
    )
    or (
      record_kind = 'antive_historical_report'
      and upper(btrim(source_organization)) = 'ANTIVE'
      and import_batch_id is not null and source_file_sha256 ~ '^[a-f0-9]{64}$'
      and length(btrim(source_sheet)) between 1 and 160
      and length(btrim(source_range)) between 1 and 160
      and source_unit_id is not null
      and length(btrim(received_confirmed_by)) between 2 and 160
      and received_confirmed_at is not null
      and (received_confirmation_note is null or length(btrim(received_confirmation_note)) between 1 and 1000)
      and (
        (proof_date is null and evidence_enriched_by is null and evidence_enriched_at is null)
        or (proof_date is not null and evidence_enriched_by is not null and evidence_enriched_at is not null)
      )
    )
  ),
  add constraint condominium_reserve_fund_receipt_void_check check (
    (void_reason is null and voided_by is null and voided_at is null)
    or (length(btrim(void_reason)) between 5 and 1000 and voided_by is not null and voided_at is not null)
  ),
  add constraint condominium_reserve_fund_receipt_state_check check (
    (
      status = 'pending' and record_kind = 'bank_receipt'
      and proof_date is not null
      and deposit_date is null and bank_confirmed_by is null
      and reconciled_by is null and reconciled_at is null
      and reversal_reason is null and reversed_by is null and reversed_at is null
      and void_reason is null and voided_by is null and voided_at is null
    )
    or (
      status = 'received_by_antive_unverified' and record_kind = 'antive_historical_report'
      and deposit_date is null and bank_confirmed_by is null
      and reconciled_by is null and reconciled_at is null
      and reversal_reason is null and reversed_by is null and reversed_at is null
      and void_reason is null and voided_by is null and voided_at is null
    )
    or (
      status = 'reconciled'
      and proof_date is not null and payment_reference is not null
      and evidence_path is not null and evidence_sha256 is not null
      and deposit_date is not null and bank_confirmed_by is not null
      and reconciled_by is not null and reconciled_at is not null
      and reversal_reason is null and reversed_by is null and reversed_at is null
      and void_reason is null and voided_by is null and voided_at is null
    )
    or (
      status = 'reversed'
      and proof_date is not null and payment_reference is not null
      and evidence_path is not null and evidence_sha256 is not null
      and deposit_date is not null and bank_confirmed_by is not null
      and reconciled_by is not null and reconciled_at is not null
      and reversal_reason is not null and reversed_by is not null and reversed_at is not null
      and void_reason is null and voided_by is null and voided_at is null
    )
    or (
      status = 'voided' and record_kind in ('bank_receipt','antive_historical_report')
      and deposit_date is null and bank_confirmed_by is null
      and reconciled_by is null and reconciled_at is null
      and reversal_reason is null and reversed_by is null and reversed_at is null
      and void_reason is not null and voided_by is not null and voided_at is not null
    )
  );

create unique index condominium_reserve_fund_antive_source_unique
on public.condominium_reserve_fund_receipts(
  condominio_id, source_file_sha256, lower(btrim(source_sheet)), upper(btrim(source_range)), source_unit_id
)
where record_kind = 'antive_historical_report';

create index condominium_reserve_fund_receipt_batch_idx
on public.condominium_reserve_fund_receipts(condominio_id, import_batch_id)
where import_batch_id is not null;

create index condominium_reserve_fund_batch_scope_idx
on public.condominium_reserve_fund_import_batches(condominio_id, created_at desc);

comment on table public.condominium_reserve_fund_import_batches is
  'Lotes auditados de Fondo de Reserva histórico reportado y confirmado como recibido por Antive.';
comment on column public.condominium_reserve_fund_receipts.record_kind is
  'bank_receipt: comprobante bancario; antive_historical_report: recepción histórica confirmada administrativamente.';
comment on column public.condominium_reserve_fund_receipts.source_range is
  'Celda o rango exacto de la fuente administrativa; junto con archivo y unidad evita duplicados.';

create function public.condominium_reserve_fund_batch_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Los lotes de Fondo de Reserva no pueden eliminarse.';
  end if;
  if tg_op = 'INSERT' and new.status <> 'active' then
    raise exception using errcode = '23514', message = 'Un lote nuevo debe iniciar activo.';
  end if;
  if tg_op = 'UPDATE' then
    if old.condominio_id is distinct from new.condominio_id
       or old.source_organization is distinct from new.source_organization
       or old.source_file_sha256 is distinct from new.source_file_sha256
       or old.source_sheet is distinct from new.source_sheet
       or old.received_confirmed_by is distinct from new.received_confirmed_by
       or old.received_confirmed_at is distinct from new.received_confirmed_at
       or old.received_confirmation_note is distinct from new.received_confirmation_note
       or old.created_by is distinct from new.created_by
       or old.created_at is distinct from new.created_at then
      raise exception using errcode = '42501', message = 'La fuente del lote es inmutable.';
    end if;
    if not (old.status = 'active' and new.status = 'voided') then
      raise exception using errcode = '23514', message = 'Transición de lote no permitida.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.condominium_reserve_fund_receipt_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Los comprobantes de Fondo de Reserva no pueden eliminarse.';
  end if;
  if new.evidence_path is not null
     and new.evidence_path !~ ('^' || new.condominio_id::text || '/' || new.id::text || '[.](pdf|jpg|jpeg|png)$') then
    raise exception using errcode = '23514', message = 'La evidencia no corresponde al registro y condominio.';
  end if;
  if tg_op = 'INSERT' and not (
    (new.record_kind = 'bank_receipt' and new.status = 'pending')
    or (new.record_kind = 'antive_historical_report' and new.status = 'received_by_antive_unverified')
  ) then
    raise exception using errcode = '23514', message = 'Estado inicial de Fondo de Reserva no permitido.';
  end if;
  if tg_op = 'UPDATE' then
    if old.condominio_id is distinct from new.condominio_id
       or old.total_amount is distinct from new.total_amount
       or old.source_organization is distinct from new.source_organization
       or old.record_kind is distinct from new.record_kind
       or old.import_batch_id is distinct from new.import_batch_id
       or old.source_file_sha256 is distinct from new.source_file_sha256
       or old.source_sheet is distinct from new.source_sheet
       or old.source_range is distinct from new.source_range
       or old.source_unit_id is distinct from new.source_unit_id
       or old.received_confirmed_by is distinct from new.received_confirmed_by
       or old.received_confirmed_at is distinct from new.received_confirmed_at
       or old.received_confirmation_note is distinct from new.received_confirmation_note
       or old.idempotency_key is distinct from new.idempotency_key
       or old.created_by is distinct from new.created_by
       or old.created_at is distinct from new.created_at then
      raise exception using errcode = '42501', message = 'Los datos fuente del registro son inmutables.';
    end if;

    if old.status = 'received_by_antive_unverified' and new.status = old.status then
      if old.proof_date is not null or old.payment_reference is not null
         or old.evidence_path is not null or old.evidence_sha256 is not null
         or old.evidence_enriched_by is not null or old.evidence_enriched_at is not null
         or new.proof_date is null or new.payment_reference is null
         or new.evidence_path is null or new.evidence_sha256 is null
         or new.evidence_enriched_by is null or new.evidence_enriched_at is null
         or old.deposit_date is distinct from new.deposit_date
         or old.bank_confirmed_by is distinct from new.bank_confirmed_by
         or old.reconciled_by is distinct from new.reconciled_by
         or old.reconciled_at is distinct from new.reconciled_at
         or old.reversal_reason is distinct from new.reversal_reason
         or old.reversed_by is distinct from new.reversed_by
         or old.reversed_at is distinct from new.reversed_at
         or old.void_reason is distinct from new.void_reason
         or old.voided_by is distinct from new.voided_by
         or old.voided_at is distinct from new.voided_at then
        raise exception using errcode = '23514', message = 'El registro no admite enriquecimiento o ya fue enriquecido.';
      end if;
    elsif not (
      (old.status = 'pending' and new.status = 'reconciled')
      or (old.status = 'received_by_antive_unverified' and new.status = 'reconciled')
      or (old.status = 'reconciled' and new.status = 'reversed')
      or (old.status in ('pending','received_by_antive_unverified') and new.status = 'voided')
    ) then
      raise exception using errcode = '23514', message = 'Transición de Fondo de Reserva no permitida.';
    end if;

    if not (old.status = 'received_by_antive_unverified' and new.status = old.status) and (
      old.proof_date is distinct from new.proof_date
      or old.payment_reference is distinct from new.payment_reference
      or old.evidence_path is distinct from new.evidence_path
      or old.evidence_sha256 is distinct from new.evidence_sha256
      or old.evidence_enriched_by is distinct from new.evidence_enriched_by
      or old.evidence_enriched_at is distinct from new.evidence_enriched_at
    ) then
      raise exception using errcode = '42501', message = 'La evidencia documentada es inmutable.';
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

create or replace function public.condominium_reserve_fund_contribution_guard()
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
  select r.condominio_id, r.status, r.source_unit_id into receipt_scope
  from public.condominium_reserve_fund_receipts r where r.id = new.receipt_id;
  if not found
     or receipt_scope.status not in ('pending','received_by_antive_unverified')
     or receipt_scope.condominio_id is distinct from new.condominio_id
     or (receipt_scope.source_unit_id is not null and receipt_scope.source_unit_id is distinct from new.unidad_id) then
    raise exception using errcode = '23514', message = 'El registro no admite esta aplicación.';
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

create trigger condominium_reserve_fund_batch_operation_guard
before insert or update or delete on public.condominium_reserve_fund_import_batches
for each row execute function public.condominium_reserve_fund_batch_guard();

create function public.condominium_import_antive_reserve_fund_batch(
  p_batch_id uuid,
  p_condominio_id uuid,
  p_source_file_sha256 text,
  p_source_sheet text,
  p_records jsonb,
  p_received_confirmed_by text,
  p_received_confirmed_at timestamptz,
  p_received_confirmation_note text default null
)
returns public.condominium_reserve_fund_import_batches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result public.condominium_reserve_fund_import_batches%rowtype;
  record_count integer;
  normalized_input jsonb;
  normalized_existing jsonb;
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios', true) then
    raise exception using errcode = '42501', message = 'Operación no autorizada.';
  end if;
  if p_batch_id is null or p_condominio_id is null
     or coalesce(p_source_file_sha256, '') !~ '^[a-f0-9]{64}$'
     or length(btrim(coalesce(p_source_sheet, ''))) not between 1 and 160
     or jsonb_typeof(p_records) <> 'array'
     or jsonb_array_length(p_records) < 1 or jsonb_array_length(p_records) > 100
     or length(btrim(coalesce(p_received_confirmed_by, ''))) not between 2 and 160
     or p_received_confirmed_at is null
     or length(btrim(coalesce(p_received_confirmation_note, ''))) > 1000 then
    raise exception using errcode = '22023', message = 'Datos del lote histórico Antive incompletos.';
  end if;

  select count(*), jsonb_agg(jsonb_build_object(
    'receipt_id', x.receipt_id::text,
    'unidad_id', x.unidad_id::text,
    'amount', x.amount,
    'source_range', upper(btrim(x.source_range)),
    'idempotency_key', x.idempotency_key::text
  ) order by x.unidad_id, upper(btrim(x.source_range)))
  into record_count, normalized_input
  from jsonb_to_recordset(p_records) as x(
    receipt_id uuid, unidad_id uuid, amount numeric, source_range text, idempotency_key uuid
  )
  where x.receipt_id is not null and x.unidad_id is not null and x.idempotency_key is not null
    and x.amount > 0 and length(btrim(coalesce(x.source_range, ''))) between 1 and 160;

  if record_count <> jsonb_array_length(p_records)
     or (select count(distinct x.receipt_id) from jsonb_to_recordset(p_records) as x(receipt_id uuid)) <> record_count
     or (select count(distinct x.idempotency_key) from jsonb_to_recordset(p_records) as x(idempotency_key uuid)) <> record_count
     or (select count(distinct x.unidad_id) from jsonb_to_recordset(p_records) as x(unidad_id uuid)) <> record_count
     or (select count(distinct upper(btrim(x.source_range))) from jsonb_to_recordset(p_records) as x(source_range text)) <> record_count then
    raise exception using errcode = '22023', message = 'Los registros del lote son inválidos o están duplicados.';
  end if;
  if (
    select count(*) from public.unidades_condominio u
    join jsonb_to_recordset(p_records) as x(unidad_id uuid) on x.unidad_id = u.id
    where u.condominio_id = p_condominio_id and u.activo = true
  ) <> record_count then
    raise exception using errcode = '23514', message = 'Existe una unidad fuera de alcance.';
  end if;

  select * into result
  from public.condominium_reserve_fund_import_batches b where b.id = p_batch_id;
  if found then
    select jsonb_agg(jsonb_build_object(
      'receipt_id', r.id::text,
      'unidad_id', c.unidad_id::text,
      'amount', c.amount,
      'source_range', upper(btrim(r.source_range)),
      'idempotency_key', r.idempotency_key::text
    ) order by c.unidad_id, upper(btrim(r.source_range)))
    into normalized_existing
    from public.condominium_reserve_fund_receipts r
    join public.condominium_reserve_fund_contributions c on c.receipt_id = r.id
    where r.import_batch_id = result.id;
    if result.condominio_id = p_condominio_id
       and result.source_file_sha256 = p_source_file_sha256
       and result.source_sheet = btrim(p_source_sheet)
       and result.received_confirmed_by = btrim(p_received_confirmed_by)
       and result.received_confirmed_at = p_received_confirmed_at
       and result.received_confirmation_note is not distinct from nullif(btrim(coalesce(p_received_confirmation_note, '')), '')
       and normalized_existing = normalized_input then
      return result;
    end if;
    raise exception using errcode = '23505', message = 'El lote ya fue utilizado con otros datos.';
  end if;

  insert into public.condominium_reserve_fund_import_batches(
    id, condominio_id, source_organization, source_file_sha256, source_sheet,
    received_confirmed_by, received_confirmed_at, received_confirmation_note, created_by
  ) values (
    p_batch_id, p_condominio_id, 'ANTIVE', p_source_file_sha256, btrim(p_source_sheet),
    btrim(p_received_confirmed_by), p_received_confirmed_at,
    nullif(btrim(coalesce(p_received_confirmation_note, '')), ''), auth.uid()
  ) returning * into result;

  begin
    insert into public.condominium_reserve_fund_receipts(
      id, condominio_id, total_amount, source_organization, status, idempotency_key, created_by,
      record_kind, import_batch_id, source_file_sha256, source_sheet, source_range, source_unit_id,
      received_confirmed_by, received_confirmed_at, received_confirmation_note
    )
    select x.receipt_id, p_condominio_id, x.amount, 'ANTIVE', 'received_by_antive_unverified',
      x.idempotency_key, auth.uid(), 'antive_historical_report', p_batch_id,
      p_source_file_sha256, btrim(p_source_sheet), upper(btrim(x.source_range)), x.unidad_id,
      btrim(p_received_confirmed_by), p_received_confirmed_at,
      nullif(btrim(coalesce(p_received_confirmation_note, '')), '')
    from jsonb_to_recordset(p_records) as x(
      receipt_id uuid, unidad_id uuid, amount numeric, source_range text, idempotency_key uuid
    );
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'La fuente administrativa ya fue utilizada en otro registro.';
  end;

  insert into public.condominium_reserve_fund_contributions(
    receipt_id, condominio_id, unidad_id, amount
  )
  select x.receipt_id, p_condominio_id, x.unidad_id, x.amount
  from jsonb_to_recordset(p_records) as x(receipt_id uuid, unidad_id uuid, amount numeric);

  return result;
end;
$$;

create function public.condominium_enrich_reserve_fund_receipt_evidence(
  p_receipt_id uuid,
  p_proof_date date,
  p_payment_reference text,
  p_evidence_path text,
  p_evidence_sha256 text
)
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
  if p_receipt_id is null or p_proof_date is null
     or length(btrim(coalesce(p_payment_reference, ''))) < 3
     or length(btrim(coalesce(p_evidence_path, ''))) < 10
     or coalesce(p_evidence_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'La evidencia complementaria está incompleta.';
  end if;
  select * into receipt from public.condominium_reserve_fund_receipts r
  where r.id = p_receipt_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Registro no encontrado.'; end if;
  if receipt.record_kind <> 'antive_historical_report'
     or receipt.status <> 'received_by_antive_unverified' then
    raise exception using errcode = '23514', message = 'El registro no admite enriquecimiento.';
  end if;
  if receipt.proof_date is not null or receipt.payment_reference is not null
     or receipt.evidence_path is not null or receipt.evidence_sha256 is not null then
    if receipt.proof_date = p_proof_date
       and receipt.payment_reference = btrim(p_payment_reference)
       and receipt.evidence_path = btrim(p_evidence_path)
       and receipt.evidence_sha256 = p_evidence_sha256 then return receipt; end if;
    raise exception using errcode = '23505', message = 'El registro ya contiene otra evidencia.';
  end if;
  update public.condominium_reserve_fund_receipts
  set proof_date = p_proof_date, payment_reference = btrim(p_payment_reference),
      evidence_path = btrim(p_evidence_path), evidence_sha256 = p_evidence_sha256,
      evidence_enriched_by = auth.uid(), evidence_enriched_at = now()
  where id = receipt.id returning * into receipt;
  return receipt;
end;
$$;

create or replace function public.condominium_reconcile_reserve_fund_receipt(
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
  select * into receipt from public.condominium_reserve_fund_receipts r
  where r.id = p_receipt_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Comprobante no encontrado.'; end if;
  if receipt.status not in ('pending','received_by_antive_unverified') then
    raise exception using errcode = '23514', message = 'El registro ya no está pendiente.';
  end if;
  if receipt.proof_date is null or receipt.payment_reference is null
     or receipt.evidence_path is null or receipt.evidence_sha256 is null then
    raise exception using errcode = '23514', message = 'No existe evidencia suficiente para conciliar.';
  end if;
  select * into controls from public.condominium_operation_controls c
  where c.condominio_id = receipt.condominio_id;
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

create function public.condominium_void_reserve_fund_receipt(p_receipt_id uuid, p_reason text)
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
    raise exception using errcode = '22023', message = 'El motivo de anulación es obligatorio.';
  end if;
  select * into receipt from public.condominium_reserve_fund_receipts r
  where r.id = p_receipt_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Registro no encontrado.'; end if;
  if receipt.status = 'voided' then return receipt; end if;
  if receipt.status not in ('pending','received_by_antive_unverified') then
    raise exception using errcode = '23514', message = 'El registro no puede anularse en su estado actual.';
  end if;
  update public.condominium_reserve_fund_receipts
  set status = 'voided', void_reason = btrim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = receipt.id returning * into receipt;
  return receipt;
end;
$$;

create function public.condominium_void_reserve_fund_batch(p_batch_id uuid, p_reason text)
returns public.condominium_reserve_fund_import_batches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare batch public.condominium_reserve_fund_import_batches%rowtype;
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios', true) then
    raise exception using errcode = '42501', message = 'Operación no autorizada.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception using errcode = '22023', message = 'El motivo de anulación es obligatorio.';
  end if;
  select * into batch from public.condominium_reserve_fund_import_batches b
  where b.id = p_batch_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Lote no encontrado.'; end if;
  if batch.status = 'voided' then return batch; end if;
  if exists(
    select 1 from public.condominium_reserve_fund_receipts r
    where r.import_batch_id = batch.id
      and r.status not in ('pending','received_by_antive_unverified','voided')
  ) then
    raise exception using errcode = '23514', message = 'El lote no puede anularse porque contiene registros conciliados o reversados.';
  end if;
  update public.condominium_reserve_fund_receipts
  set status = 'voided', void_reason = btrim(p_reason), voided_by = auth.uid(), voided_at = now()
  where import_batch_id = batch.id and status in ('pending','received_by_antive_unverified');
  update public.condominium_reserve_fund_import_batches
  set status = 'voided', void_reason = btrim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = batch.id returning * into batch;
  return batch;
end;
$$;

alter table public.condominium_reserve_fund_import_batches enable row level security;
alter table public.condominium_reserve_fund_import_batches force row level security;

create policy condominium_reserve_fund_batch_internal_select
on public.condominium_reserve_fund_import_batches for select to authenticated
using (public.condominium_internal_permission('condominios', false));

revoke all on table public.condominium_reserve_fund_import_batches from public, anon, authenticated, service_role;
grant select on table public.condominium_reserve_fund_import_batches to authenticated, service_role;

revoke all on function public.condominium_reserve_fund_batch_guard() from public, anon, authenticated, service_role;
revoke all on function public.condominium_import_antive_reserve_fund_batch(uuid,uuid,text,text,jsonb,text,timestamptz,text) from public, anon, service_role;
revoke all on function public.condominium_enrich_reserve_fund_receipt_evidence(uuid,date,text,text,text) from public, anon, service_role;
revoke all on function public.condominium_void_reserve_fund_receipt(uuid,text) from public, anon, service_role;
revoke all on function public.condominium_void_reserve_fund_batch(uuid,text) from public, anon, service_role;
grant execute on function public.condominium_import_antive_reserve_fund_batch(uuid,uuid,text,text,jsonb,text,timestamptz,text) to authenticated;
grant execute on function public.condominium_enrich_reserve_fund_receipt_evidence(uuid,date,text,text,text) to authenticated;
grant execute on function public.condominium_void_reserve_fund_receipt(uuid,text) to authenticated;
grant execute on function public.condominium_void_reserve_fund_batch(uuid,text) to authenticated;

commit;
