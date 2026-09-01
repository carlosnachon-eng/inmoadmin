-- Aportaciones independientes a Fondo de Reserva del módulo condominal.
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
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Faltan dependencias del módulo condominal endurecido o Storage.';
  end if;

  if to_regclass('public.condominium_reserve_fund_contributions') is not null
     or to_regprocedure('public.condominium_create_reserve_fund_contribution(uuid,uuid,uuid,numeric,text,date,text,text,text,uuid)') is not null
     or to_regprocedure('public.condominium_reconcile_reserve_fund_contribution(uuid,date,text)') is not null
     or to_regprocedure('public.condominium_reverse_reserve_fund_contribution(uuid,text)') is not null then
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

create table public.condominium_reserve_fund_contributions (
  id uuid primary key,
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  unidad_id uuid not null references public.unidades_condominio(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
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
  constraint condominium_reserve_fund_state_audit_check check (
    (
      status = 'pending'
      and deposit_date is null
      and bank_confirmed_by is null
      and reconciled_by is null and reconciled_at is null
      and reversal_reason is null and reversed_by is null and reversed_at is null
    )
    or (
      status = 'reconciled'
      and deposit_date is not null
      and bank_confirmed_by is not null
      and reconciled_by is not null and reconciled_at is not null
      and reversal_reason is null and reversed_by is null and reversed_at is null
    )
    or (
      status = 'reversed'
      and deposit_date is not null
      and bank_confirmed_by is not null
      and reconciled_by is not null and reconciled_at is not null
      and reversal_reason is not null and reversed_by is not null and reversed_at is not null
    )
  ),
  constraint condominium_reserve_fund_idempotency_unique unique (condominio_id, idempotency_key),
  constraint condominium_reserve_fund_evidence_unique unique (condominio_id, evidence_sha256)
);

comment on table public.condominium_reserve_fund_contributions is
  'Aportaciones independientes al Fondo de Reserva. No forman parte de cuotas, cartera histórica, recuperaciones, gastos ni KPI de cobranza.';
comment on column public.condominium_reserve_fund_contributions.source_organization is
  'Organización que reporta o custodia el ingreso durante la transición.';
comment on column public.condominium_reserve_fund_contributions.evidence_path is
  'Ruta privada en Storage; nunca una URL pública.';

create index condominium_reserve_fund_scope_status_idx
on public.condominium_reserve_fund_contributions(condominio_id, status, proof_date desc);

create index condominium_reserve_fund_unit_idx
on public.condominium_reserve_fund_contributions(unidad_id, proof_date desc);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'condominium-reserve-fund-evidence',
  'condominium-reserve-fund-evidence',
  false,
  5242880,
  array['application/pdf','image/jpeg','image/png']::text[]
)
on conflict (id) do nothing;

-- No se crean políticas de Storage para anon/authenticated. La carga y las URL
-- firmadas pasan exclusivamente por el endpoint server-side tras autorizar al operador.

create function public.condominium_reserve_fund_contribution_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  unit_scope record;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Las aportaciones al Fondo de Reserva no pueden eliminarse.';
  end if;

  select u.id, u.condominio_id, u.activo
  into unit_scope
  from public.unidades_condominio u
  where u.id = new.unidad_id;
  if not found
     or unit_scope.condominio_id is distinct from new.condominio_id
     or unit_scope.activo is distinct from true then
    raise exception using errcode = '23514', message = 'La unidad no corresponde al condominio o está inactiva.';
  end if;

  if new.evidence_path !~ (
    '^' || new.condominio_id::text || '/' || new.unidad_id::text || '/' || new.id::text || '[.](pdf|jpg|jpeg|png)$'
  ) then
    raise exception using errcode = '23514', message = 'La evidencia no corresponde al alcance de la aportación.';
  end if;

  if tg_op = 'INSERT' and new.status <> 'pending' then
    raise exception using errcode = '23514', message = 'Una aportación nueva debe iniciar pendiente de conciliación.';
  end if;

  if tg_op = 'UPDATE' then
    if old.condominio_id is distinct from new.condominio_id
       or old.unidad_id is distinct from new.unidad_id
       or old.amount is distinct from new.amount
       or old.source_organization is distinct from new.source_organization
       or old.proof_date is distinct from new.proof_date
       or old.payment_reference is distinct from new.payment_reference
       or old.evidence_path is distinct from new.evidence_path
       or old.evidence_sha256 is distinct from new.evidence_sha256
       or old.idempotency_key is distinct from new.idempotency_key
       or old.created_by is distinct from new.created_by
       or old.created_at is distinct from new.created_at then
      raise exception using errcode = '42501', message = 'Los datos fuente de la aportación son inmutables.';
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

create trigger condominium_reserve_fund_contribution_operation_guard
before insert or update or delete on public.condominium_reserve_fund_contributions
for each row execute function public.condominium_reserve_fund_contribution_guard();

create function public.condominium_create_reserve_fund_contribution(
  p_contribution_id uuid,
  p_condominio_id uuid,
  p_unidad_id uuid,
  p_amount numeric,
  p_source_organization text,
  p_proof_date date,
  p_payment_reference text,
  p_evidence_path text,
  p_evidence_sha256 text,
  p_idempotency_key uuid
)
returns public.condominium_reserve_fund_contributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result public.condominium_reserve_fund_contributions%rowtype;
  target_unit public.unidades_condominio%rowtype;
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios', true) then
    raise exception using errcode = '42501', message = 'Operación no autorizada.';
  end if;
  if p_contribution_id is null or p_idempotency_key is null
     or p_amount is null or p_amount <= 0
     or length(btrim(coalesce(p_source_organization, ''))) < 2
     or p_proof_date is null
     or length(btrim(coalesce(p_payment_reference, ''))) < 3
     or length(btrim(coalesce(p_evidence_path, ''))) < 10
     or coalesce(p_evidence_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Datos de Fondo de Reserva incompletos.';
  end if;

  select * into result
  from public.condominium_reserve_fund_contributions c
  where c.condominio_id = p_condominio_id and c.idempotency_key = p_idempotency_key;
  if found then
    if result.unidad_id = p_unidad_id
       and result.amount = p_amount
       and result.source_organization = btrim(p_source_organization)
       and result.proof_date = p_proof_date
       and result.payment_reference = btrim(p_payment_reference)
       and result.evidence_sha256 = p_evidence_sha256 then
      return result;
    end if;
    raise exception using errcode = '23505', message = 'La clave de idempotencia ya fue utilizada con otros datos.';
  end if;

  select * into target_unit
  from public.unidades_condominio u
  where u.id = p_unidad_id
    and u.condominio_id = p_condominio_id
    and u.activo = true;
  if not found then
    raise exception using errcode = '23514', message = 'Unidad fuera de alcance.';
  end if;

  insert into public.condominium_reserve_fund_contributions(
    id, condominio_id, unidad_id, amount, source_organization,
    proof_date, payment_reference, evidence_path, evidence_sha256,
    status, idempotency_key, created_by
  ) values (
    p_contribution_id, p_condominio_id, p_unidad_id, p_amount, btrim(p_source_organization),
    p_proof_date, btrim(p_payment_reference), btrim(p_evidence_path), p_evidence_sha256,
    'pending', p_idempotency_key, auth.uid()
  ) returning * into result;
  return result;
exception
  when unique_violation then
    select * into result
    from public.condominium_reserve_fund_contributions c
    where c.condominio_id = p_condominio_id and c.idempotency_key = p_idempotency_key;
    if found and result.unidad_id = p_unidad_id
       and result.amount = p_amount
       and result.source_organization = btrim(p_source_organization)
       and result.proof_date = p_proof_date
       and result.payment_reference = btrim(p_payment_reference)
       and result.evidence_sha256 = p_evidence_sha256 then
      return result;
    end if;
    raise;
end;
$$;

create function public.condominium_reconcile_reserve_fund_contribution(
  p_contribution_id uuid,
  p_deposit_date date,
  p_bank_confirmed_by text
)
returns public.condominium_reserve_fund_contributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  contribution public.condominium_reserve_fund_contributions%rowtype;
  controls public.condominium_operation_controls%rowtype;
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios', true) then
    raise exception using errcode = '42501', message = 'Operación no autorizada.';
  end if;
  if p_deposit_date is null or length(btrim(coalesce(p_bank_confirmed_by, ''))) < 2 then
    raise exception using errcode = '22023', message = 'La confirmación bancaria está incompleta.';
  end if;

  select * into contribution
  from public.condominium_reserve_fund_contributions c
  where c.id = p_contribution_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Aportación no encontrada.';
  end if;
  if contribution.status <> 'pending' then
    raise exception using errcode = '23514', message = 'La aportación ya no está pendiente.';
  end if;

  select * into controls
  from public.condominium_operation_controls c
  where c.condominio_id = contribution.condominio_id;
  if found and not controls.real_payments_enabled then
    raise exception using errcode = '55000', message = 'La confirmación de pagos reales está bloqueada.';
  end if;

  update public.condominium_reserve_fund_contributions
  set status = 'reconciled', deposit_date = p_deposit_date,
      bank_confirmed_by = btrim(p_bank_confirmed_by),
      reconciled_by = auth.uid(), reconciled_at = now()
  where id = contribution.id
  returning * into contribution;
  return contribution;
end;
$$;

create function public.condominium_reverse_reserve_fund_contribution(
  p_contribution_id uuid,
  p_reason text
)
returns public.condominium_reserve_fund_contributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  contribution public.condominium_reserve_fund_contributions%rowtype;
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios', true) then
    raise exception using errcode = '42501', message = 'Operación no autorizada.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception using errcode = '22023', message = 'El motivo de reversión es obligatorio.';
  end if;

  select * into contribution
  from public.condominium_reserve_fund_contributions c
  where c.id = p_contribution_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Aportación no encontrada.';
  end if;
  if contribution.status <> 'reconciled' then
    raise exception using errcode = '23514', message = 'Sólo puede revertirse una aportación conciliada.';
  end if;

  update public.condominium_reserve_fund_contributions
  set status = 'reversed', reversal_reason = btrim(p_reason),
      reversed_by = auth.uid(), reversed_at = now()
  where id = contribution.id
  returning * into contribution;
  return contribution;
end;
$$;

alter table public.condominium_reserve_fund_contributions enable row level security;
alter table public.condominium_reserve_fund_contributions force row level security;

create policy condominium_reserve_fund_internal_select
on public.condominium_reserve_fund_contributions
for select
to authenticated
using (public.condominium_internal_permission('condominios', false));

revoke all on table public.condominium_reserve_fund_contributions from public, anon, authenticated, service_role;
grant select on table public.condominium_reserve_fund_contributions to authenticated, service_role;

revoke all on function public.condominium_reserve_fund_contribution_guard() from public, anon, authenticated, service_role;
revoke all on function public.condominium_create_reserve_fund_contribution(uuid,uuid,uuid,numeric,text,date,text,text,text,uuid) from public, anon, service_role;
revoke all on function public.condominium_reconcile_reserve_fund_contribution(uuid,date,text) from public, anon, service_role;
revoke all on function public.condominium_reverse_reserve_fund_contribution(uuid,text) from public, anon, service_role;
grant execute on function public.condominium_create_reserve_fund_contribution(uuid,uuid,uuid,numeric,text,date,text,text,text,uuid) to authenticated;
grant execute on function public.condominium_reconcile_reserve_fund_contribution(uuid,date,text) to authenticated;
grant execute on function public.condominium_reverse_reserve_fund_contribution(uuid,text) to authenticated;

commit;
