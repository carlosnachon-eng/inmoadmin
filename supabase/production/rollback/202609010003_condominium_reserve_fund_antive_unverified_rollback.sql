-- Rollback conservador de la extensión histórica Antive.
-- Una vez que exista un lote o registro histórico, se usa anulación auditada y NO rollback destructivo.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.condominium_reserve_fund_import_batches') is not null
     and exists(select 1 from public.condominium_reserve_fund_import_batches) then
    raise exception 'ROLLBACK ABORTADO: existen lotes históricos Antive; utilice anulación auditada.';
  end if;
  if exists(
    select 1 from public.condominium_reserve_fund_receipts
    where record_kind <> 'bank_receipt'
       or status not in ('pending','reconciled','reversed')
       or import_batch_id is not null
       or source_file_sha256 is not null
       or source_sheet is not null
       or source_range is not null
       or source_unit_id is not null
       or received_confirmed_by is not null
       or received_confirmed_at is not null
       or evidence_enriched_by is not null
       or evidence_enriched_at is not null
       or voided_by is not null
       or voided_at is not null
  ) then
    raise exception 'ROLLBACK ABORTADO: existe actividad de la extensión histórica Antive.';
  end if;
end $$;

drop function if exists public.condominium_void_reserve_fund_batch(uuid,text);
drop function if exists public.condominium_void_reserve_fund_receipt(uuid,text);
drop function if exists public.condominium_enrich_reserve_fund_receipt_evidence(uuid,date,text,text,text);
drop function if exists public.condominium_import_antive_reserve_fund_batch(uuid,uuid,text,text,jsonb,text,timestamptz,text);
drop trigger if exists condominium_reserve_fund_batch_operation_guard on public.condominium_reserve_fund_import_batches;
drop function if exists public.condominium_reserve_fund_batch_guard();

drop index if exists public.condominium_reserve_fund_antive_source_unique;
drop index if exists public.condominium_reserve_fund_receipt_batch_idx;

alter table public.condominium_reserve_fund_receipts
  drop constraint condominium_reserve_fund_receipt_state_check,
  drop constraint condominium_reserve_fund_receipt_source_check,
  drop constraint condominium_reserve_fund_receipt_evidence_complete_check,
  drop constraint condominium_reserve_fund_receipt_void_check,
  drop constraint condominium_reserve_fund_receipts_record_kind_check,
  drop constraint condominium_reserve_fund_receipts_status_check,
  drop column record_kind,
  drop column import_batch_id,
  drop column source_file_sha256,
  drop column source_sheet,
  drop column source_range,
  drop column source_unit_id,
  drop column received_confirmed_by,
  drop column received_confirmed_at,
  drop column received_confirmation_note,
  drop column evidence_enriched_by,
  drop column evidence_enriched_at,
  drop column void_reason,
  drop column voided_by,
  drop column voided_at,
  alter column proof_date set not null,
  alter column payment_reference set not null,
  alter column evidence_path set not null,
  alter column evidence_sha256 set not null,
  add constraint condominium_reserve_fund_receipts_status_check
    check (status in ('pending','reconciled','reversed')),
  add constraint condominium_reserve_fund_receipt_state_check check (
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
  );

drop table if exists public.condominium_reserve_fund_import_batches;

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

commit;
