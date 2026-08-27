-- Fase 2 Génova: fundamento condominal aditivo y reutilizable.
-- NO contiene datos de Génova, PII, cargos, pagos ni usuarios.
-- NO actualiza, recalcula ni reasigna registros existentes.

begin;

create table public.condominium_operation_controls (
  condominio_id uuid primary key references public.condominios(id) on delete restrict,
  lifecycle_status text not null default 'preimplementation'
    check (lifecycle_status in ('preimplementation','ready_for_activation','active','suspended')),
  owner_portal_enabled boolean not null default false,
  communications_enabled boolean not null default false,
  current_billing_enabled boolean not null default false,
  receipts_enabled boolean not null default false,
  real_payments_enabled boolean not null default false,
  money_movements_enabled boolean not null default false,
  activation_authorized_at timestamptz null,
  activation_authorized_by uuid null references public.profiles(id) on delete restrict,
  notes text null check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint condominium_operation_controls_activation_check check (
    lifecycle_status <> 'active'
    or (
      activation_authorized_at is not null
      and activation_authorized_by is not null
      and current_billing_enabled
    )
  )
);

comment on table public.condominium_operation_controls is
  'Opt-in controls. Condominios without a row preserve legacy behavior; controlled condominiums fail closed.';

create table public.condominium_sections (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  code text not null check (length(btrim(code)) between 1 and 30),
  name text not null check (length(btrim(name)) between 1 and 120),
  section_type text not null default 'tower' check (section_type in ('tower','building','phase','other')),
  legal_status text not null default 'operational_label'
    check (legal_status in ('operational_label','pending_review','validated_regime')),
  active boolean not null default true,
  notes text null check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  unique (condominio_id, code),
  unique (id, condominio_id)
);

create table public.condominium_unit_section_memberships (
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  unidad_id uuid primary key references public.unidades_condominio(id) on delete restrict,
  section_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (section_id, condominio_id)
    references public.condominium_sections(id, condominio_id) on delete restrict
);

create table public.condominium_historical_accounts (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  unidad_id uuid not null references public.unidades_condominio(id) on delete restrict,
  source_organization text not null check (length(btrim(source_organization)) between 2 and 120),
  source_label text not null default 'SALDO HISTORICO REPORTADO POR TERCERO',
  source_sha256 text null check (source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$'),
  cutoff_date date not null,
  reported_charges numeric(14,2) not null default 0 check (reported_charges >= 0),
  reported_payments numeric(14,2) not null default 0 check (reported_payments >= 0),
  reported_balance numeric(14,2) not null,
  review_status text not null default 'REPORTADO'
    check (review_status in ('REPORTADO','EN_REVISION','VALIDADO','CONTROVERTIDO')),
  validated_charges numeric(14,2) null check (validated_charges is null or validated_charges >= 0),
  validated_payments numeric(14,2) null check (validated_payments is null or validated_payments >= 0),
  validated_balance numeric(14,2) null,
  validation_notes text null check (validation_notes is null or length(validation_notes) <= 4000),
  reviewed_by uuid null references public.profiles(id) on delete restrict,
  reviewed_at timestamptz null,
  validated_by uuid null references public.profiles(id) on delete restrict,
  validated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (condominio_id, unidad_id, source_organization, cutoff_date),
  constraint condominium_historical_accounts_reported_reconciles check (
    abs((reported_charges - reported_payments) - reported_balance) < 0.01
  ),
  constraint condominium_historical_accounts_validation_check check (
    (review_status <> 'VALIDADO' and validated_by is null and validated_at is null)
    or (
      review_status = 'VALIDADO'
      and validated_charges is not null
      and validated_payments is not null
      and validated_balance is not null
      and validated_by is not null
      and validated_at is not null
      and abs((validated_charges - validated_payments) - validated_balance) < 0.01
    )
  )
);

create table public.condominium_historical_payments (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  historical_account_id uuid not null references public.condominium_historical_accounts(id) on delete restrict,
  unidad_id uuid not null references public.unidades_condominio(id) on delete restrict,
  reported_period text null check (reported_period is null or reported_period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  reported_amount numeric(14,2) not null check (reported_amount > 0),
  received_by text not null,
  source_label text not null default 'PAGO HISTORICO REPORTADO / RECIBIDO POR TERCERO',
  source_reference text null check (source_reference is null or length(source_reference) <= 200),
  review_status text not null default 'REPORTADO'
    check (review_status in ('REPORTADO','EN_REVISION','VALIDADO','CONTROVERTIDO')),
  evidence_reference text null check (evidence_reference is null or length(evidence_reference) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint condominium_historical_payments_no_emporio_receipt check (
    upper(btrim(received_by)) <> 'EMPORIO'
  )
);

create table public.condominium_historical_recoveries (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  historical_account_id uuid not null references public.condominium_historical_accounts(id) on delete restrict,
  unidad_id uuid not null references public.unidades_condominio(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  collected_at date not null,
  status text not null default 'PENDIENTE_APLICACION'
    check (status in ('PENDIENTE_APLICACION','APLICADO','REVERSADO')),
  current_receipt_id text null,
  notes text null check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict
);

create table public.condominium_provider_preparations (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  service_category text not null check (service_category in ('vigilancia','jardineria','electricidad_comun','limpieza','agua','mantenimiento','otro')),
  provider_name text null check (provider_name is null or length(btrim(provider_name)) between 2 and 200),
  preliminary_amount numeric(14,2) null check (preliminary_amount is null or preliminary_amount >= 0),
  frequency text null check (frequency is null or frequency in ('semanal','mensual','bimestral','trimestral','eventual','por_definir')),
  documentation_status text not null default 'PENDIENTE'
    check (documentation_status in ('PENDIENTE','EN_REVISION','COMPLETA','DESCARTADO')),
  approved_budget boolean not null default false,
  payment_enabled boolean not null default false,
  notes text null check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint condominium_provider_preparations_payment_check check (
    not payment_enabled or (approved_budget and documentation_status = 'COMPLETA')
  )
);

create table public.condominium_transition_items (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  category text not null check (category in ('ANTIVE_DESARROLLADOR','ADMINISTRACION_ORDINARIA','EXTRAORDINARIO','POR_DETERMINAR')),
  title text not null check (length(btrim(title)) between 3 and 200),
  description text null check (description is null or length(description) <= 4000),
  operational_status text not null default 'ABIERTO'
    check (operational_status in ('ABIERTO','EN_REVISION','EN_PROCESO','CERRADO','CANCELADO')),
  legal_responsibility_status text not null default 'POR_DETERMINAR'
    check (legal_responsibility_status in ('POR_DETERMINAR','DOCUMENTADA')),
  evidence_reference text null check (evidence_reference is null or length(evidence_reference) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index condominium_sections_condominio_idx on public.condominium_sections(condominio_id, active);
create index condominium_historical_accounts_condominio_status_idx on public.condominium_historical_accounts(condominio_id, review_status);
create index condominium_historical_payments_account_idx on public.condominium_historical_payments(historical_account_id, reported_period);
create index condominium_historical_recoveries_account_idx on public.condominium_historical_recoveries(historical_account_id, status);
create index condominium_provider_preparations_condominio_idx on public.condominium_provider_preparations(condominio_id, documentation_status);
create index condominium_transition_items_condominio_idx on public.condominium_transition_items(condominio_id, category, operational_status);

create or replace function public.condominium_assert_unit_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.unidades_condominio u
    where u.id = new.unidad_id and u.condominio_id = new.condominio_id
  ) then
    raise exception using errcode = '23514', message = 'La unidad no pertenece al condominio indicado.';
  end if;
  if tg_table_name in ('condominium_historical_payments','condominium_historical_recoveries') then
    if not exists (
      select 1 from public.condominium_historical_accounts h
      where h.id = new.historical_account_id
        and h.condominio_id = new.condominio_id
        and h.unidad_id = new.unidad_id
    ) then
      raise exception using errcode = '23514', message = 'La cuenta histórica no corresponde a la unidad y condominio.';
    end if;
  end if;
  return new;
end;
$$;

create trigger condominium_unit_section_scope_guard
before insert or update on public.condominium_unit_section_memberships
for each row execute function public.condominium_assert_unit_scope();
create trigger condominium_historical_account_scope_guard
before insert or update on public.condominium_historical_accounts
for each row execute function public.condominium_assert_unit_scope();
create trigger condominium_historical_payment_scope_guard
before insert or update on public.condominium_historical_payments
for each row execute function public.condominium_assert_unit_scope();
create trigger condominium_historical_recovery_scope_guard
before insert or update on public.condominium_historical_recoveries
for each row execute function public.condominium_assert_unit_scope();

create or replace function public.condominium_fee_operation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  controls public.condominium_operation_controls%rowtype;
begin
  select * into controls
  from public.condominium_operation_controls c
  where c.condominio_id = new.condominio_id;

  -- Sin fila de control: comportamiento legacy intacto para Tecaxco y clientes actuales.
  if not found then return new; end if;

  if tg_op = 'INSERT' and not controls.current_billing_enabled then
    raise exception using errcode = '55000', message = 'La emisión de cuotas está bloqueada durante preimplementación.';
  end if;
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'pagado' and not controls.real_payments_enabled then
      raise exception using errcode = '55000', message = 'La confirmación de pagos reales está bloqueada.';
    end if;
    if new.status = 'atrasado' and not controls.current_billing_enabled then
      raise exception using errcode = '55000', message = 'La gestión de cuota corriente está bloqueada.';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.recibo_url is distinct from new.recibo_url
     and new.recibo_url is not null and not controls.receipts_enabled then
    raise exception using errcode = '55000', message = 'La emisión de recibos está bloqueada.';
  end if;
  return new;
end;
$$;

create trigger condominium_fee_operation_guard
before insert or update on public.cuotas_condominio
for each row execute function public.condominium_fee_operation_guard();

create or replace function public.condominium_expense_operation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_condominium_id uuid;
  allowed boolean;
begin
  target_condominium_id := case
    when tg_op = 'DELETE' then old.condominio_id
    else new.condominio_id
  end;

  select c.money_movements_enabled into allowed
  from public.condominium_operation_controls c
  where c.condominio_id = target_condominium_id;
  if found and not allowed then
    raise exception using errcode = '55000', message = 'Los gastos y movimientos reales están bloqueados durante preimplementación.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger condominium_expense_operation_guard
before insert or update or delete on public.gastos_condominio
for each row execute function public.condominium_expense_operation_guard();

create or replace function public.condominium_owner_portal_allowed(p_condominio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select c.owner_portal_enabled
    from public.condominium_operation_controls c
    where c.condominio_id = p_condominio_id
  ), true)
$$;

create or replace view public.condominium_current_collection_kpis
with (security_invoker = true)
as
select
  q.condominio_id,
  q.periodo,
  sum(q.monto)::numeric(14,2) as current_issued,
  sum(q.monto) filter (where q.status = 'pagado')::numeric(14,2) as current_collected,
  case when sum(q.monto) = 0 then 0
    else (sum(q.monto) filter (where q.status = 'pagado') / sum(q.monto))::numeric
  end as current_collection_rate
from public.cuotas_condominio q
group by q.condominio_id, q.periodo;

create or replace view public.condominium_historical_collection_kpis
with (security_invoker = true)
as
select
  h.condominio_id,
  sum(h.reported_balance)::numeric(14,2) as historical_reported,
  coalesce(sum(h.validated_balance) filter (where h.review_status = 'VALIDADO'), 0)::numeric(14,2) as historical_validated,
  coalesce((select sum(r.amount) from public.condominium_historical_recoveries r where r.condominio_id = h.condominio_id and r.status = 'APLICADO'), 0)::numeric(14,2) as historical_recovered
from public.condominium_historical_accounts h
group by h.condominio_id;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'condominium_operation_controls','condominium_sections','condominium_unit_section_memberships',
    'condominium_historical_accounts','condominium_historical_payments','condominium_historical_recoveries',
    'condominium_provider_preparations','condominium_transition_items'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant all privileges on public.%I to service_role', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.current_profile_role_id() in (''admin'',''coord_operaciones''))',
      table_name || '_internal_select', table_name
    );
  end loop;
end;
$$;

revoke all on function public.condominium_assert_unit_scope() from public, anon, authenticated;
revoke all on function public.condominium_fee_operation_guard() from public, anon, authenticated;
revoke all on function public.condominium_expense_operation_guard() from public, anon, authenticated;
revoke all on function public.condominium_owner_portal_allowed(uuid) from public, anon;
grant execute on function public.condominium_owner_portal_allowed(uuid) to authenticated, service_role;
grant select on public.condominium_current_collection_kpis to authenticated, service_role;
grant select on public.condominium_historical_collection_kpis to authenticated, service_role;

commit;
