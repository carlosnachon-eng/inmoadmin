-- Operación segura de recuperaciones históricas condominales.
-- No contiene datos, PII, usuarios, cuotas, pagos ni recuperaciones reales.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.condominium_historical_recoveries') is null
     or to_regclass('public.condominium_historical_accounts') is null
     or to_regclass('public.condominium_operation_controls') is null
     or to_regclass('public.cuotas_condominio') is null
     or to_regprocedure('public.condominium_internal_permission(text,boolean)') is null
     or to_regprocedure('public.condominium_owner_portal_snapshot(uuid)') is null
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Faltan dependencias del módulo condominal endurecido o Storage.';
  end if;

  -- El corte certificado previo a esta primera capa tiene cero recuperaciones.
  -- Si aparece una, se requiere conciliación explícita antes de cambiar el contrato.
  if exists (select 1 from public.condominium_historical_recoveries) then
    raise exception 'MIGRACION ABORTADA: existen recuperaciones históricas que requieren conciliación previa.';
  end if;
end $$;

alter table public.condominium_historical_recoveries
  alter column collected_at drop not null,
  add column payment_reference text not null check (length(btrim(payment_reference)) between 3 and 160),
  add column proof_received_at timestamptz not null,
  add column evidence_path text not null check (
    length(btrim(evidence_path)) between 10 and 500
    and evidence_path !~* '^https?://'
  ),
  add column evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  add column custodian_organization text not null default 'ANTIVE'
    check (upper(btrim(custodian_organization)) = 'ANTIVE'),
  add column bank_confirmation_reference text null
    check (bank_confirmation_reference is null or length(btrim(bank_confirmation_reference)) between 2 and 160),
  add column reconciled_by uuid null references public.profiles(id) on delete restrict,
  add column reconciled_at timestamptz null,
  add column applied_by uuid null references public.profiles(id) on delete restrict,
  add column applied_at timestamptz null,
  add column reversal_reason text null
    check (reversal_reason is null or length(btrim(reversal_reason)) between 5 and 1000),
  add column reversed_by uuid null references public.profiles(id) on delete restrict,
  add column reversed_at timestamptz null,
  add column idempotency_key uuid not null,
  add column deposit_total numeric(14,2) not null check (deposit_total > 0),
  add column current_fee_id uuid null references public.cuotas_condominio(id) on delete restrict,
  add column updated_at timestamptz not null default now(),
  add constraint condominium_historical_recoveries_deposit_allocation_check
    check (deposit_total >= amount),
  add constraint condominium_historical_recoveries_state_audit_check check (
    (
      status = 'PENDIENTE_APLICACION'
      and collected_at is null
      and bank_confirmation_reference is null
      and reconciled_by is null and reconciled_at is null
      and applied_by is null and applied_at is null
      and reversal_reason is null and reversed_by is null and reversed_at is null
    )
    or (
      status = 'APLICADO'
      and collected_at is not null
      and bank_confirmation_reference is not null
      and reconciled_by is not null and reconciled_at is not null
      and applied_by is not null and applied_at is not null
      and reversal_reason is null and reversed_by is null and reversed_at is null
    )
    or (
      status = 'REVERSADO'
      and collected_at is not null
      and bank_confirmation_reference is not null
      and reconciled_by is not null and reconciled_at is not null
      and applied_by is not null and applied_at is not null
      and reversal_reason is not null and reversed_by is not null and reversed_at is not null
    )
  ),
  add constraint condominium_historical_recoveries_idempotency_unique
    unique (condominio_id, idempotency_key),
  add constraint condominium_historical_recoveries_evidence_unique
    unique (condominio_id, evidence_sha256);

create index condominium_historical_recoveries_status_idx
on public.condominium_historical_recoveries(condominio_id, status, proof_received_at desc);

do $$
begin
  if exists(
    select 1 from storage.buckets b
    where b.id='condominium-historical-evidence'
      and (
        b.public is distinct from false
        or b.file_size_limit is distinct from 5242880
        or b.allowed_mime_types is distinct from array['application/pdf','image/jpeg','image/png']::text[]
      )
  ) then
    raise exception 'MIGRACION ABORTADA: el bucket de evidencia existe con otra configuración.';
  end if;
end $$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'condominium-historical-evidence',
  'condominium-historical-evidence',
  false,
  5242880,
  array['application/pdf','image/jpeg','image/png']::text[]
)
on conflict (id) do nothing;

-- No se crean políticas de Storage para anon/authenticated. Sólo el endpoint
-- server-side puede cargar o firmar temporalmente un objeto después de autorizar.

create or replace function public.condominium_historical_recovery_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  account_balance numeric(14,2);
  already_applied numeric(14,2);
  fee_row public.cuotas_condominio%rowtype;
  controls public.condominium_operation_controls%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Las recuperaciones históricas no pueden eliminarse.';
  end if;

  if new.evidence_path !~ ('^' || new.condominio_id::text || '/' || new.unidad_id::text || '/' || new.id::text || '[.](pdf|jpg|jpeg|png)$') then
    raise exception using errcode = '23514', message = 'La evidencia no corresponde al alcance de la recuperación.';
  end if;

  if new.current_fee_id is null and new.deposit_total <> new.amount then
    raise exception using errcode = '23514', message = 'El total del depósito no coincide con la recuperación histórica.';
  end if;

  if new.current_fee_id is not null then
    select * into fee_row from public.cuotas_condominio q where q.id = new.current_fee_id;
    if not found
       or fee_row.condominio_id is distinct from new.condominio_id
       or fee_row.unidad_id is distinct from new.unidad_id then
      raise exception using errcode = '23514', message = 'La cuota corriente no corresponde a la unidad y condominio.';
    end if;
    if new.deposit_total <> new.amount + fee_row.monto then
      raise exception using errcode = '23514', message = 'El total no coincide con las aplicaciones histórica y corriente.';
    end if;
  end if;

  if tg_op = 'INSERT' and new.status <> 'PENDIENTE_APLICACION' then
    raise exception using errcode = '23514', message = 'Una recuperación nueva debe iniciar pendiente de aplicación.';
  end if;

  if tg_op = 'UPDATE' then
    if old.condominio_id is distinct from new.condominio_id
       or old.historical_account_id is distinct from new.historical_account_id
       or old.unidad_id is distinct from new.unidad_id
       or old.amount is distinct from new.amount
       or old.payment_reference is distinct from new.payment_reference
       or old.proof_received_at is distinct from new.proof_received_at
       or old.evidence_path is distinct from new.evidence_path
       or old.evidence_sha256 is distinct from new.evidence_sha256
       or old.custodian_organization is distinct from new.custodian_organization
       or old.idempotency_key is distinct from new.idempotency_key
       or old.deposit_total is distinct from new.deposit_total
       or old.current_fee_id is distinct from new.current_fee_id
       or old.created_by is distinct from new.created_by
       or old.created_at is distinct from new.created_at then
      raise exception using errcode = '42501', message = 'Los datos fuente de la recuperación son inmutables.';
    end if;
    if not (
      (old.status = 'PENDIENTE_APLICACION' and new.status = 'APLICADO')
      or (old.status = 'APLICADO' and new.status = 'REVERSADO')
    ) then
      raise exception using errcode = '23514', message = 'Transición de recuperación no permitida.';
    end if;
  end if;

  select * into controls
  from public.condominium_operation_controls c
  where c.condominio_id = new.condominio_id;
  if found and new.status = 'APLICADO' and not controls.real_payments_enabled then
    raise exception using errcode = '55000', message = 'La confirmación de pagos reales está bloqueada.';
  end if;

  if new.status = 'APLICADO' then
    select h.reported_balance into account_balance
    from public.condominium_historical_accounts h
    where h.id = new.historical_account_id
      and h.condominio_id = new.condominio_id
      and h.unidad_id = new.unidad_id
    for update;
    if not found then
      raise exception using errcode = '23514', message = 'La cuenta histórica no corresponde a la recuperación.';
    end if;

    select coalesce(sum(r.amount), 0) into already_applied
    from public.condominium_historical_recoveries r
    where r.historical_account_id = new.historical_account_id
      and r.status = 'APLICADO'
      and r.id <> new.id;
    if new.amount > greatest(account_balance - already_applied, 0) then
      raise exception using errcode = '23514', message = 'La recuperación excede el saldo histórico pendiente.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists condominium_historical_recovery_operation_guard
on public.condominium_historical_recoveries;
create trigger condominium_historical_recovery_operation_guard
before insert or update or delete on public.condominium_historical_recoveries
for each row execute function public.condominium_historical_recovery_guard();

create or replace function public.condominium_create_historical_recovery(
  p_recovery_id uuid,
  p_condominio_id uuid,
  p_unidad_id uuid,
  p_historical_account_id uuid,
  p_amount numeric,
  p_deposit_total numeric,
  p_payment_reference text,
  p_proof_received_at timestamptz,
  p_evidence_path text,
  p_evidence_sha256 text,
  p_idempotency_key uuid,
  p_current_fee_id uuid default null
)
returns public.condominium_historical_recoveries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result public.condominium_historical_recoveries%rowtype;
  account_balance numeric(14,2);
  already_applied numeric(14,2);
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios', true) then
    raise exception using errcode = '42501', message = 'Operación no autorizada.';
  end if;
  if p_recovery_id is null or p_idempotency_key is null
     or p_amount is null or p_amount <= 0
     or p_deposit_total is null or p_deposit_total <= 0
     or length(btrim(coalesce(p_payment_reference, ''))) < 3
     or p_proof_received_at is null
     or length(btrim(coalesce(p_evidence_path, ''))) < 10
     or coalesce(p_evidence_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Datos de recuperación incompletos.';
  end if;

  select * into result
  from public.condominium_historical_recoveries r
  where r.condominio_id = p_condominio_id and r.idempotency_key = p_idempotency_key;
  if found then
    if result.unidad_id = p_unidad_id
       and result.historical_account_id = p_historical_account_id
       and result.amount = p_amount
       and result.deposit_total = p_deposit_total
       and result.payment_reference = btrim(p_payment_reference)
       and result.evidence_sha256 = p_evidence_sha256
       and result.current_fee_id is not distinct from p_current_fee_id then
      return result;
    end if;
    raise exception using errcode = '23505', message = 'La clave de idempotencia ya fue utilizada con otros datos.';
  end if;

  select h.reported_balance into account_balance
  from public.condominium_historical_accounts h
  where h.id = p_historical_account_id
    and h.condominio_id = p_condominio_id
    and h.unidad_id = p_unidad_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'Cuenta histórica fuera de alcance.';
  end if;
  select coalesce(sum(r.amount), 0) into already_applied
  from public.condominium_historical_recoveries r
  where r.historical_account_id = p_historical_account_id and r.status = 'APLICADO';
  if p_amount > greatest(account_balance - already_applied, 0) then
    raise exception using errcode = '23514', message = 'La recuperación excede el saldo histórico pendiente.';
  end if;

  insert into public.condominium_historical_recoveries(
    id, condominio_id, historical_account_id, unidad_id, amount, collected_at,
    status, payment_reference, proof_received_at, evidence_path, evidence_sha256,
    custodian_organization, created_by, idempotency_key, deposit_total, current_fee_id
  ) values (
    p_recovery_id, p_condominio_id, p_historical_account_id, p_unidad_id, p_amount, null,
    'PENDIENTE_APLICACION', btrim(p_payment_reference), p_proof_received_at, btrim(p_evidence_path), p_evidence_sha256,
    'ANTIVE', auth.uid(), p_idempotency_key, p_deposit_total, p_current_fee_id
  ) returning * into result;
  return result;
exception
  when unique_violation then
    select * into result
    from public.condominium_historical_recoveries r
    where r.condominio_id = p_condominio_id and r.idempotency_key = p_idempotency_key;
    if found and result.unidad_id = p_unidad_id
       and result.historical_account_id = p_historical_account_id
       and result.amount = p_amount
       and result.deposit_total = p_deposit_total
       and result.payment_reference = btrim(p_payment_reference)
       and result.evidence_sha256 = p_evidence_sha256
       and result.current_fee_id is not distinct from p_current_fee_id then
      return result;
    end if;
    raise;
end;
$$;

create or replace function public.condominium_apply_historical_recovery(
  p_recovery_id uuid,
  p_collected_at date,
  p_bank_confirmation_reference text
)
returns public.condominium_historical_recoveries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recovery public.condominium_historical_recoveries%rowtype;
  fee public.cuotas_condominio%rowtype;
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios', true) then
    raise exception using errcode = '42501', message = 'Operación no autorizada.';
  end if;
  if p_collected_at is null or length(btrim(coalesce(p_bank_confirmation_reference, ''))) < 2 then
    raise exception using errcode = '22023', message = 'Confirmación bancaria incompleta.';
  end if;

  select * into recovery
  from public.condominium_historical_recoveries r
  where r.id = p_recovery_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Recuperación no encontrada.'; end if;
  if recovery.status <> 'PENDIENTE_APLICACION' then
    raise exception using errcode = '23514', message = 'La recuperación ya no está pendiente.';
  end if;

  if recovery.current_fee_id is not null then
    select * into fee from public.cuotas_condominio q
    where q.id = recovery.current_fee_id
      and q.condominio_id = recovery.condominio_id
      and q.unidad_id = recovery.unidad_id
    for update;
    if not found or fee.status = 'pagado' then
      raise exception using errcode = '23514', message = 'La cuota corriente no puede aplicarse.';
    end if;
    if recovery.deposit_total <> recovery.amount + fee.monto then
      raise exception using errcode = '23514', message = 'Las aplicaciones no coinciden con el depósito.';
    end if;
    update public.cuotas_condominio
    set status = 'pagado', fecha_pago = p_collected_at,
        forma_pago = 'TRANSFERENCIA_ANTIVE'
    where id = fee.id;
  end if;

  update public.condominium_historical_recoveries
  set status = 'APLICADO', collected_at = p_collected_at,
      bank_confirmation_reference = btrim(p_bank_confirmation_reference),
      reconciled_by = auth.uid(), reconciled_at = now(),
      applied_by = auth.uid(), applied_at = now()
  where id = recovery.id
  returning * into recovery;
  return recovery;
end;
$$;

create or replace function public.condominium_reverse_historical_recovery(
  p_recovery_id uuid,
  p_reason text
)
returns public.condominium_historical_recoveries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare recovery public.condominium_historical_recoveries%rowtype;
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios', true) then
    raise exception using errcode = '42501', message = 'Operación no autorizada.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception using errcode = '22023', message = 'El motivo de reversión es obligatorio.';
  end if;
  select * into recovery
  from public.condominium_historical_recoveries r
  where r.id = p_recovery_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Recuperación no encontrada.'; end if;
  if recovery.status <> 'APLICADO' then
    raise exception using errcode = '23514', message = 'Sólo puede revertirse una recuperación aplicada.';
  end if;

  update public.condominium_historical_recoveries
  set status = 'REVERSADO', reversal_reason = btrim(p_reason),
      reversed_by = auth.uid(), reversed_at = now()
  where id = recovery.id
  returning * into recovery;
  return recovery;
end;
$$;

revoke all on function public.condominium_create_historical_recovery(uuid,uuid,uuid,uuid,numeric,numeric,text,timestamptz,text,text,uuid,uuid) from public, anon;
revoke all on function public.condominium_apply_historical_recovery(uuid,date,text) from public, anon;
revoke all on function public.condominium_reverse_historical_recovery(uuid,text) from public, anon;
grant execute on function public.condominium_create_historical_recovery(uuid,uuid,uuid,uuid,numeric,numeric,text,timestamptz,text,text,uuid,uuid) to authenticated, service_role;
grant execute on function public.condominium_apply_historical_recovery(uuid,date,text) to authenticated, service_role;
grant execute on function public.condominium_reverse_historical_recovery(uuid,text) to authenticated, service_role;

-- El Portal controlado recibe sólo importes agregados; nunca evidencia ni referencias.
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
        'historicalRecovered',coalesce((select sum(r.amount) from public.condominium_historical_recoveries r where r.historical_account_id=h.id and r.status='APLICADO'),0),
        'historicalPending',greatest(h.reported_balance-coalesce((select sum(r.amount) from public.condominium_historical_recoveries r where r.historical_account_id=h.id and r.status='APLICADO'),0),0),
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

revoke all on function public.condominium_owner_portal_snapshot(uuid) from public,anon;
grant execute on function public.condominium_owner_portal_snapshot(uuid) to authenticated,service_role;

commit;
