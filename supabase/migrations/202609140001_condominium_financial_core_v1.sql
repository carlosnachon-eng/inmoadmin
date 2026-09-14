-- InmoAdmin Condominios: fundación financiera inerte y motor transaccional V1.
-- Aditiva: no lee, migra ni escribe datos financieros legacy.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $$ begin
  if to_regclass('public.condominios') is null
     or to_regclass('public.unidades_condominio') is null
     or to_regclass('public.profiles') is null
     or to_regprocedure('public.condominium_internal_permission(text,boolean)') is null then
    raise exception 'FINANCIAL_CORE_DEPENDENCY_MISSING';
  end if;
  if to_regclass('public.condominium_financial_controls') is not null then
    raise exception 'FINANCIAL_CORE_ALREADY_PRESENT_REQUIRES_RECONCILIATION';
  end if;
end $$;

create table public.condominium_financial_controls(
  condominio_id uuid primary key references public.condominios(id) on delete restrict,
  ledger_enabled boolean not null default false,
  activated_at timestamptz,
  activated_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((not ledger_enabled and activated_at is null and activated_by is null)
      or (ledger_enabled and activated_at is not null and activated_by is not null))
);

create table public.condominium_funds(
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  code text not null check(code ~ '^[A-Z0-9_]{2,40}$'),
  name text not null check(length(btrim(name)) between 2 and 120),
  fund_type text not null check(fund_type in ('operating','reserve','special','custodial','other')),
  currency char(3) not null default 'MXN' check(currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(condominio_id,code), unique(id,condominio_id)
);

create table public.condominium_bank_accounts(
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  code text not null check(code ~ '^[A-Z0-9_]{2,40}$'),
  display_name text not null check(length(btrim(display_name)) between 2 and 120),
  institution_name text not null check(length(btrim(institution_name)) between 2 and 120),
  account_fingerprint text not null check(account_fingerprint ~ '^[a-f0-9]{64}$'),
  custodian_name text not null check(length(btrim(custodian_name)) between 2 and 160),
  currency char(3) not null default 'MXN' check(currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  opened_at date,
  closed_at date,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(condominio_id,code), unique(condominio_id,account_fingerprint), unique(id,condominio_id),
  check(closed_at is null or opened_at is null or closed_at>=opened_at)
);

create table public.condominium_charge_concepts(
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  fund_id uuid not null,
  code text not null check(code ~ '^[A-Z0-9_]{2,50}$'),
  name text not null check(length(btrim(name)) between 2 and 160),
  concept_type text not null check(concept_type in ('ordinary_fee','extraordinary_fee','reserve_contribution','legacy_opening_balance','other')),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(fund_id,condominio_id) references public.condominium_funds(id,condominio_id) on delete restrict,
  unique(condominio_id,code), unique(id,condominio_id)
);

create table public.condominium_financial_periods(
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  period_code text not null check(period_code ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open' check(status in ('open','under_review','closed','reopened')),
  closed_at timestamptz, closed_by uuid references public.profiles(id) on delete restrict,
  closing_fingerprint text check(closing_fingerprint is null or closing_fingerprint ~ '^[a-f0-9]{64}$'),
  reopened_at timestamptz, reopened_by uuid references public.profiles(id) on delete restrict,
  reopening_reason text check(reopening_reason is null or length(btrim(reopening_reason)) between 5 and 1000),
  created_at timestamptz not null default now(),
  unique(condominio_id,period_code), unique(id,condominio_id),
  check(ends_on>=starts_on),
  check((status in ('open','under_review') and closed_at is null and closed_by is null)
     or (status='closed' and closed_at is not null and closed_by is not null and closing_fingerprint is not null)
     or (status='reopened' and closed_at is not null and closed_by is not null and closing_fingerprint is not null and reopened_at is not null and reopened_by is not null and reopening_reason is not null))
);

create table public.condominium_charges(
  id uuid primary key,
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  unidad_id uuid not null references public.unidades_condominio(id) on delete restrict,
  concept_id uuid not null,
  fund_id uuid not null,
  period_id uuid not null,
  amount numeric(14,2) not null check(amount>0),
  due_date date,
  description text check(description is null or length(description)<=1000),
  status text not null default 'open' check(status in ('open','partially_paid','paid','reversed')),
  idempotency_key uuid not null,
  reversed_at timestamptz, reversed_by uuid references public.profiles(id) on delete restrict,
  reversal_reason text check(reversal_reason is null or length(btrim(reversal_reason)) between 5 and 1000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(concept_id,condominio_id) references public.condominium_charge_concepts(id,condominio_id) on delete restrict,
  foreign key(fund_id,condominio_id) references public.condominium_funds(id,condominio_id) on delete restrict,
  foreign key(period_id,condominio_id) references public.condominium_financial_periods(id,condominio_id) on delete restrict,
  unique(condominio_id,idempotency_key), unique(id,condominio_id),
  check((status<>'reversed' and reversed_at is null and reversed_by is null and reversal_reason is null)
     or (status='reversed' and reversed_at is not null and reversed_by is not null and reversal_reason is not null))
);

create table public.condominium_bank_transactions(
  id uuid primary key,
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  bank_account_id uuid not null,
  booked_on date not null,
  value_on date,
  direction text not null check(direction in ('credit','debit')),
  amount numeric(14,2) not null check(amount>0),
  bank_reference text,
  description text,
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'unmatched' check(status in ('unmatched','partially_matched','matched','reconciled','reversed')),
  identified_unidad_id uuid references public.unidades_condominio(id) on delete restrict,
  identified_at timestamptz, identified_by uuid references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(bank_account_id,condominio_id) references public.condominium_bank_accounts(id,condominio_id) on delete restrict,
  unique(condominio_id,bank_account_id,source_hash), unique(condominio_id,idempotency_key), unique(id,condominio_id)
);

create table public.condominium_receipts(
  id uuid primary key,
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  unidad_id uuid references public.unidades_condominio(id) on delete restrict,
  received_on date not null,
  amount numeric(14,2) not null check(amount>0),
  currency char(3) not null default 'MXN' check(currency ~ '^[A-Z]{3}$'),
  payer_reference text,
  evidence_path text check(evidence_path is null or (length(evidence_path) between 10 and 500 and evidence_path !~* '^https?://')),
  evidence_sha256 text check(evidence_sha256 is null or evidence_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'registered' check(status in ('registered','partially_applied','applied','reconciled','reversed')),
  idempotency_key uuid not null,
  reversed_at timestamptz, reversed_by uuid references public.profiles(id) on delete restrict,
  reversal_reason text check(reversal_reason is null or length(btrim(reversal_reason)) between 5 and 1000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(condominio_id,idempotency_key), unique(id,condominio_id),
  check((evidence_path is null)=(evidence_sha256 is null)),
  check((status<>'reversed' and reversed_at is null and reversed_by is null and reversal_reason is null)
     or (status='reversed' and reversed_at is not null and reversed_by is not null and reversal_reason is not null))
);

create table public.condominium_payment_applications(
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  receipt_id uuid not null,
  charge_id uuid not null,
  fund_id uuid not null,
  amount numeric(14,2) not null check(amount>0),
  status text not null default 'active' check(status in ('active','reversed')),
  reversed_at timestamptz, reversal_entry_id uuid,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(receipt_id,condominio_id) references public.condominium_receipts(id,condominio_id) on delete restrict,
  foreign key(charge_id,condominio_id) references public.condominium_charges(id,condominio_id) on delete restrict,
  foreign key(fund_id,condominio_id) references public.condominium_funds(id,condominio_id) on delete restrict,
  unique(receipt_id,charge_id), unique(id,condominio_id)
);

create table public.condominium_bank_matches(
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  bank_transaction_id uuid not null,
  receipt_id uuid not null,
  amount numeric(14,2) not null check(amount>0),
  status text not null default 'active' check(status in ('active','reversed')),
  idempotency_key uuid not null,
  matched_by uuid not null references public.profiles(id) on delete restrict,
  matched_at timestamptz not null default now(),
  reversed_at timestamptz,
  foreign key(bank_transaction_id,condominio_id) references public.condominium_bank_transactions(id,condominio_id) on delete restrict,
  foreign key(receipt_id,condominio_id) references public.condominium_receipts(id,condominio_id) on delete restrict,
  unique(condominio_id,idempotency_key), unique(bank_transaction_id,receipt_id), unique(id,condominio_id)
);

create table public.condominium_reconciliations(
  id uuid primary key,
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  bank_account_id uuid not null,
  period_id uuid not null,
  statement_opening_balance numeric(14,2) not null,
  statement_closing_balance numeric(14,2) not null,
  ledger_closing_balance numeric(14,2),
  difference numeric(14,2),
  status text not null default 'draft' check(status in ('draft','confirmed','reversed')),
  idempotency_key uuid not null,
  confirmed_at timestamptz, confirmed_by uuid references public.profiles(id) on delete restrict,
  reversed_at timestamptz, reversed_by uuid references public.profiles(id) on delete restrict,
  reversal_reason text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(bank_account_id,condominio_id) references public.condominium_bank_accounts(id,condominio_id) on delete restrict,
  foreign key(period_id,condominio_id) references public.condominium_financial_periods(id,condominio_id) on delete restrict,
  unique(condominio_id,idempotency_key), unique(id,condominio_id)
);

create table public.condominium_journal_entries(
  id uuid primary key,
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  period_id uuid not null,
  entry_date date not null,
  event_type text not null check(event_type in ('charge_created','receipt_reconciled','operation_reversed','adjustment')),
  source_type text not null,
  source_id uuid not null,
  status text not null default 'draft' check(status in ('draft','posted','reversed')),
  reverses_entry_id uuid references public.condominium_journal_entries(id) on delete restrict,
  idempotency_key uuid not null,
  posted_at timestamptz, posted_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(period_id,condominio_id) references public.condominium_financial_periods(id,condominio_id) on delete restrict,
  unique(condominio_id,idempotency_key), unique(id,condominio_id),
  check((status='draft' and posted_at is null and posted_by is null) or (status in ('posted','reversed') and posted_at is not null and posted_by is not null))
);

create table public.condominium_journal_lines(
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  entry_id uuid not null,
  line_no integer not null check(line_no>0),
  account_code text not null check(account_code in ('BANK','ACCOUNTS_RECEIVABLE','ASSESSMENT_REVENUE','UNAPPLIED_CREDITS')),
  bank_account_id uuid,
  fund_id uuid not null,
  unidad_id uuid references public.unidades_condominio(id) on delete restrict,
  charge_id uuid references public.condominium_charges(id) on delete restrict,
  debit numeric(14,2) not null default 0 check(debit>=0),
  credit numeric(14,2) not null default 0 check(credit>=0),
  created_at timestamptz not null default now(),
  foreign key(entry_id,condominio_id) references public.condominium_journal_entries(id,condominio_id) on delete restrict,
  foreign key(bank_account_id,condominio_id) references public.condominium_bank_accounts(id,condominio_id) on delete restrict,
  foreign key(fund_id,condominio_id) references public.condominium_funds(id,condominio_id) on delete restrict,
  unique(entry_id,line_no),
  check((debit>0 and credit=0) or (credit>0 and debit=0)),
  check((account_code='BANK' and bank_account_id is not null) or (account_code<>'BANK' and bank_account_id is null))
);

alter table public.condominium_payment_applications add foreign key(reversal_entry_id,condominio_id) references public.condominium_journal_entries(id,condominio_id) on delete restrict;

create table public.condominium_financial_events(
  id bigint generated always as identity primary key,
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  actor_id uuid references public.profiles(id) on delete restrict,
  reason_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check(jsonb_typeof(metadata)='object')
);

create index financial_charges_scope_idx on public.condominium_charges(condominio_id,period_id,unidad_id,status);
create index financial_bank_tx_scope_idx on public.condominium_bank_transactions(condominio_id,bank_account_id,booked_on,status);
create index financial_receipts_scope_idx on public.condominium_receipts(condominio_id,received_on,status);
create index financial_app_receipt_idx on public.condominium_payment_applications(receipt_id,status);
create index financial_app_charge_idx on public.condominium_payment_applications(charge_id,status);
create index financial_matches_tx_idx on public.condominium_bank_matches(bank_transaction_id,status);
create index financial_journal_scope_idx on public.condominium_journal_entries(condominio_id,period_id,entry_date,status);
create index financial_lines_dimensions_idx on public.condominium_journal_lines(condominio_id,fund_id,unidad_id,account_code);
create index financial_events_entity_idx on public.condominium_financial_events(condominio_id,entity_type,entity_id,created_at);

create function public.condominium_financial_assert(p_condominio_id uuid,p_edit boolean default true)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.condominium_internal_permission('condominios',p_edit) then raise exception using errcode='42501',message='FINANCIAL_OPERATION_NOT_ALLOWED'; end if;
  if not exists(select 1 from public.condominium_financial_controls c where c.condominio_id=p_condominio_id and c.ledger_enabled) then raise exception using errcode='55000',message='CONDOMINIUM_LEDGER_INACTIVE'; end if;
end $$;

create function public.condominium_financial_period_assert(p_condominio_id uuid,p_period_id uuid)
returns public.condominium_financial_periods language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p public.condominium_financial_periods;
begin
  select * into p from public.condominium_financial_periods x where x.id=p_period_id and x.condominio_id=p_condominio_id;
  if not found or p.status not in ('open','reopened') then raise exception using errcode='55000',message='FINANCIAL_PERIOD_NOT_OPEN'; end if;
  return p;
end $$;

create function public.condominium_financial_post_entry(p_entry_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.condominium_journal_entries; d numeric; c numeric;
begin
  select * into e from public.condominium_journal_entries where id=p_entry_id for update;
  if not found or e.status<>'draft' then raise exception 'JOURNAL_ENTRY_NOT_DRAFT'; end if;
  select coalesce(sum(debit),0),coalesce(sum(credit),0) into d,c from public.condominium_journal_lines where entry_id=e.id;
  if d<=0 or d<>c then raise exception using errcode='23514',message='JOURNAL_ENTRY_UNBALANCED'; end if;
  update public.condominium_journal_entries set status='posted',posted_at=now(),posted_by=auth.uid() where id=e.id;
end $$;

create function public.condominium_financial_create_charge(p_id uuid,p_condominio_id uuid,p_unidad_id uuid,p_concept_id uuid,p_period_id uuid,p_amount numeric,p_due_date date,p_description text,p_idempotency_key uuid)
returns public.condominium_charges language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.condominium_charges; concept public.condominium_charge_concepts; entry_id uuid:=gen_random_uuid();
begin
  perform public.condominium_financial_assert(p_condominio_id,true); perform public.condominium_financial_period_assert(p_condominio_id,p_period_id);
  if p_id is null or p_idempotency_key is null or p_amount<=0 then raise exception 'INVALID_CHARGE'; end if;
  select * into r from public.condominium_charges where condominio_id=p_condominio_id and idempotency_key=p_idempotency_key;
  if found then if r.id=p_id and r.unidad_id=p_unidad_id and r.concept_id=p_concept_id and r.period_id=p_period_id and r.amount=p_amount then return r; end if; raise exception using errcode='23505',message='IDEMPOTENCY_CONFLICT'; end if;
  if not exists(select 1 from public.unidades_condominio u where u.id=p_unidad_id and u.condominio_id=p_condominio_id and u.activo) then raise exception 'UNIT_OUT_OF_SCOPE'; end if;
  select * into concept from public.condominium_charge_concepts where id=p_concept_id and condominio_id=p_condominio_id and active;
  if not found then raise exception 'CONCEPT_OUT_OF_SCOPE'; end if;
  insert into public.condominium_charges(id,condominio_id,unidad_id,concept_id,fund_id,period_id,amount,due_date,description,idempotency_key,created_by)
  values(p_id,p_condominio_id,p_unidad_id,p_concept_id,concept.fund_id,p_period_id,p_amount,p_due_date,nullif(btrim(p_description),''),p_idempotency_key,auth.uid()) returning * into r;
  insert into public.condominium_journal_entries(id,condominio_id,period_id,entry_date,event_type,source_type,source_id,idempotency_key)
  values(entry_id,p_condominio_id,p_period_id,current_date,'charge_created','charge',r.id,gen_random_uuid());
  insert into public.condominium_journal_lines(condominio_id,entry_id,line_no,account_code,fund_id,unidad_id,charge_id,debit,credit) values
  (p_condominio_id,entry_id,1,'ACCOUNTS_RECEIVABLE',r.fund_id,r.unidad_id,r.id,r.amount,0),
  (p_condominio_id,entry_id,2,'ASSESSMENT_REVENUE',r.fund_id,r.unidad_id,r.id,0,r.amount);
  perform public.condominium_financial_post_entry(entry_id);
  insert into public.condominium_financial_events(condominio_id,event_type,entity_type,entity_id,actor_id) values(p_condominio_id,'created','charge',r.id,auth.uid());
  return r;
end $$;

create function public.condominium_financial_import_bank_transaction(p_id uuid,p_condominio_id uuid,p_bank_account_id uuid,p_booked_on date,p_value_on date,p_direction text,p_amount numeric,p_bank_reference text,p_description text,p_source_hash text,p_idempotency_key uuid)
returns public.condominium_bank_transactions language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.condominium_bank_transactions;
begin
  perform public.condominium_financial_assert(p_condominio_id,true);
  if p_id is null or p_idempotency_key is null or p_booked_on is null or p_direction not in ('credit','debit') or p_amount<=0 or p_source_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_BANK_TRANSACTION'; end if;
  select * into r from public.condominium_bank_transactions where condominio_id=p_condominio_id and idempotency_key=p_idempotency_key;
  if found then if r.id=p_id and r.bank_account_id=p_bank_account_id and r.amount=p_amount and r.source_hash=p_source_hash then return r; end if; raise exception using errcode='23505',message='IDEMPOTENCY_CONFLICT'; end if;
  insert into public.condominium_bank_transactions(id,condominio_id,bank_account_id,booked_on,value_on,direction,amount,bank_reference,description,source_hash,idempotency_key,created_by)
  values(p_id,p_condominio_id,p_bank_account_id,p_booked_on,p_value_on,p_direction,p_amount,nullif(btrim(p_bank_reference),''),nullif(btrim(p_description),''),p_source_hash,p_idempotency_key,auth.uid()) returning * into r;
  insert into public.condominium_financial_events(condominio_id,event_type,entity_type,entity_id,actor_id) values(p_condominio_id,'imported','bank_transaction',r.id,auth.uid()); return r;
end $$;

create function public.condominium_financial_identify_bank_transaction(p_transaction_id uuid,p_condominio_id uuid,p_unidad_id uuid)
returns public.condominium_bank_transactions language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.condominium_bank_transactions;
begin
  perform public.condominium_financial_assert(p_condominio_id,true);
  if not exists(select 1 from public.unidades_condominio where id=p_unidad_id and condominio_id=p_condominio_id and activo) then raise exception 'UNIT_OUT_OF_SCOPE'; end if;
  select * into r from public.condominium_bank_transactions where id=p_transaction_id and condominio_id=p_condominio_id for update;
  if not found or r.status not in ('unmatched','partially_matched') then raise exception 'BANK_TRANSACTION_NOT_IDENTIFIABLE'; end if;
  update public.condominium_bank_transactions set identified_unidad_id=p_unidad_id,identified_at=now(),identified_by=auth.uid(),updated_at=now() where id=r.id returning * into r;
  insert into public.condominium_financial_events(condominio_id,event_type,entity_type,entity_id,actor_id) values(p_condominio_id,'identified','bank_transaction',r.id,auth.uid()); return r;
end $$;

create function public.condominium_financial_create_receipt(p_id uuid,p_condominio_id uuid,p_unidad_id uuid,p_received_on date,p_amount numeric,p_payer_reference text,p_evidence_path text,p_evidence_sha256 text,p_idempotency_key uuid)
returns public.condominium_receipts language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.condominium_receipts;
begin
  perform public.condominium_financial_assert(p_condominio_id,true);
  if p_id is null or p_idempotency_key is null or p_received_on is null or p_amount<=0 or ((p_evidence_path is null)<>(p_evidence_sha256 is null)) then raise exception 'INVALID_RECEIPT'; end if;
  if p_unidad_id is not null and not exists(select 1 from public.unidades_condominio where id=p_unidad_id and condominio_id=p_condominio_id and activo) then raise exception 'UNIT_OUT_OF_SCOPE'; end if;
  select * into r from public.condominium_receipts where condominio_id=p_condominio_id and idempotency_key=p_idempotency_key;
  if found then if r.id=p_id and r.unidad_id is not distinct from p_unidad_id and r.amount=p_amount then return r; end if; raise exception using errcode='23505',message='IDEMPOTENCY_CONFLICT'; end if;
  insert into public.condominium_receipts(id,condominio_id,unidad_id,received_on,amount,payer_reference,evidence_path,evidence_sha256,idempotency_key,created_by)
  values(p_id,p_condominio_id,p_unidad_id,p_received_on,p_amount,nullif(btrim(p_payer_reference),''),p_evidence_path,p_evidence_sha256,p_idempotency_key,auth.uid()) returning * into r;
  insert into public.condominium_financial_events(condominio_id,event_type,entity_type,entity_id,actor_id) values(p_condominio_id,'registered','receipt',r.id,auth.uid()); return r;
end $$;

create function public.condominium_financial_apply_receipt(p_receipt_id uuid,p_condominio_id uuid,p_applications jsonb)
returns public.condominium_receipts language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.condominium_receipts; x record; available numeric; prior numeric; target public.condominium_charges;
begin
  perform public.condominium_financial_assert(p_condominio_id,true);
  if jsonb_typeof(p_applications)<>'array' or jsonb_array_length(p_applications)=0 then raise exception 'INVALID_APPLICATIONS'; end if;
  select * into r from public.condominium_receipts where id=p_receipt_id and condominio_id=p_condominio_id for update;
  if not found or r.status in ('reconciled','reversed') then raise exception 'RECEIPT_NOT_APPLICABLE'; end if;
  select r.amount-coalesce(sum(a.amount) filter(where a.status='active'),0) into available from public.condominium_receipts z left join public.condominium_payment_applications a on a.receipt_id=z.id where z.id=r.id group by z.amount;
  if (select coalesce(sum((e->>'amount')::numeric),0) from jsonb_array_elements(p_applications)e)>available then raise exception using errcode='23514',message='APPLICATION_EXCEEDS_RECEIPT_AVAILABLE'; end if;
  for x in select (e->>'chargeId')::uuid charge_id,(e->>'amount')::numeric amount from jsonb_array_elements(p_applications)e loop
    if x.amount<=0 then raise exception 'INVALID_APPLICATION_AMOUNT'; end if;
    select * into target from public.condominium_charges where id=x.charge_id and condominio_id=p_condominio_id for update;
    if not found or target.status='reversed' then raise exception 'CHARGE_OUT_OF_SCOPE'; end if;
    select coalesce(sum(amount),0) into prior from public.condominium_payment_applications where charge_id=target.id and status='active';
    if prior+x.amount>target.amount then raise exception using errcode='23514',message='APPLICATION_EXCEEDS_CHARGE_BALANCE'; end if;
    insert into public.condominium_payment_applications(condominio_id,receipt_id,charge_id,fund_id,amount,created_by) values(p_condominio_id,r.id,target.id,target.fund_id,x.amount,auth.uid());
  end loop;
  select coalesce(sum(amount),0) into prior from public.condominium_payment_applications where receipt_id=r.id and status='active';
  update public.condominium_receipts set status=case when prior=amount then 'applied' else 'partially_applied' end,updated_at=now() where id=r.id returning * into r;
  insert into public.condominium_financial_events(condominio_id,event_type,entity_type,entity_id,actor_id,metadata) values(p_condominio_id,'applied','receipt',r.id,auth.uid(),jsonb_build_object('applicationCount',jsonb_array_length(p_applications))); return r;
end $$;

create function public.condominium_financial_match_bank_receipt(p_condominio_id uuid,p_transaction_id uuid,p_receipt_id uuid,p_amount numeric,p_idempotency_key uuid)
returns public.condominium_bank_matches language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.condominium_bank_transactions; r public.condominium_receipts; m public.condominium_bank_matches; tm numeric; rm numeric;
begin
  perform public.condominium_financial_assert(p_condominio_id,true);
  select * into t from public.condominium_bank_transactions where id=p_transaction_id and condominio_id=p_condominio_id for update;
  select * into r from public.condominium_receipts where id=p_receipt_id and condominio_id=p_condominio_id for update;
  if not found or t.id is null or t.direction<>'credit' or r.status='reversed' or p_amount<=0 then raise exception 'MATCH_SCOPE_INVALID'; end if;
  select coalesce(sum(amount),0) into tm from public.condominium_bank_matches where bank_transaction_id=t.id and status='active';
  select coalesce(sum(amount),0) into rm from public.condominium_bank_matches where receipt_id=r.id and status='active';
  if tm+p_amount>t.amount or rm+p_amount>r.amount then raise exception using errcode='23514',message='MATCH_EXCEEDS_AVAILABLE'; end if;
  insert into public.condominium_bank_matches(condominio_id,bank_transaction_id,receipt_id,amount,idempotency_key,matched_by) values(p_condominio_id,t.id,r.id,p_amount,p_idempotency_key,auth.uid()) returning * into m;
  update public.condominium_bank_transactions set status=case when tm+p_amount=amount then 'matched' else 'partially_matched' end,updated_at=now() where id=t.id;
  insert into public.condominium_financial_events(condominio_id,event_type,entity_type,entity_id,actor_id) values(p_condominio_id,'matched','bank_transaction',t.id,auth.uid()); return m;
end $$;

create function public.condominium_financial_confirm_receipt(p_condominio_id uuid,p_receipt_id uuid,p_period_id uuid,p_idempotency_key uuid)
returns public.condominium_journal_entries language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.condominium_receipts; e public.condominium_journal_entries; bank_id uuid; default_fund_id uuid; matched numeric; applied numeric; n integer:=0; a record;
begin
  perform public.condominium_financial_assert(p_condominio_id,true); perform public.condominium_financial_period_assert(p_condominio_id,p_period_id);
  select * into r from public.condominium_receipts where id=p_receipt_id and condominio_id=p_condominio_id for update;
  if not found or r.status not in ('applied','partially_applied','registered') then raise exception 'RECEIPT_NOT_CONFIRMABLE'; end if;
  select sum(m.amount),min(t.bank_account_id) into matched,bank_id from public.condominium_bank_matches m join public.condominium_bank_transactions t on t.id=m.bank_transaction_id where m.receipt_id=r.id and m.status='active';
  if coalesce(matched,0)<>r.amount or (select count(distinct t.bank_account_id) from public.condominium_bank_matches m join public.condominium_bank_transactions t on t.id=m.bank_transaction_id where m.receipt_id=r.id and m.status='active')<>1 then raise exception 'RECEIPT_NOT_FULLY_BANK_MATCHED'; end if;
  insert into public.condominium_journal_entries(id,condominio_id,period_id,entry_date,event_type,source_type,source_id,idempotency_key) values(gen_random_uuid(),p_condominio_id,p_period_id,r.received_on,'receipt_reconciled','receipt',r.id,p_idempotency_key) returning * into e;
  for a in select x.*,c.unidad_id from public.condominium_payment_applications x join public.condominium_charges c on c.id=x.charge_id where x.receipt_id=r.id and x.status='active' order by x.id loop
    n:=n+1; insert into public.condominium_journal_lines(condominio_id,entry_id,line_no,account_code,bank_account_id,fund_id,unidad_id,charge_id,debit,credit) values(p_condominio_id,e.id,n,'BANK',bank_id,a.fund_id,a.unidad_id,a.charge_id,a.amount,0);
    n:=n+1; insert into public.condominium_journal_lines(condominio_id,entry_id,line_no,account_code,fund_id,unidad_id,charge_id,debit,credit) values(p_condominio_id,e.id,n,'ACCOUNTS_RECEIVABLE',a.fund_id,a.unidad_id,a.charge_id,0,a.amount);
  end loop;
  select coalesce(sum(amount),0) into applied from public.condominium_payment_applications where receipt_id=r.id and status='active';
  if r.amount>applied then
    select fund_id into default_fund_id from public.condominium_funds where condominio_id=p_condominio_id and active order by case when fund_type='operating' then 0 else 1 end,id limit 1;
    if default_fund_id is null then raise exception 'DEFAULT_FUND_MISSING'; end if;
    n:=n+1; insert into public.condominium_journal_lines(condominio_id,entry_id,line_no,account_code,bank_account_id,fund_id,debit,credit) values(p_condominio_id,e.id,n,'BANK',bank_id,default_fund_id,r.amount-applied,0);
    n:=n+1; insert into public.condominium_journal_lines(condominio_id,entry_id,line_no,account_code,fund_id,debit,credit) values(p_condominio_id,e.id,n,'UNAPPLIED_CREDITS',default_fund_id,0,r.amount-applied);
  end if;
  perform public.condominium_financial_post_entry(e.id);
  update public.condominium_receipts set status='reconciled',updated_at=now() where id=r.id;
  update public.condominium_charges c set status=case
    when coalesce((select sum(a.amount) from public.condominium_payment_applications a join public.condominium_receipts rr on rr.id=a.receipt_id where a.charge_id=c.id and a.status='active' and rr.status='reconciled'),0)=c.amount then 'paid'
    when coalesce((select sum(a.amount) from public.condominium_payment_applications a join public.condominium_receipts rr on rr.id=a.receipt_id where a.charge_id=c.id and a.status='active' and rr.status='reconciled'),0)>0 then 'partially_paid'
    else 'open' end,updated_at=now()
  where exists(select 1 from public.condominium_payment_applications a where a.receipt_id=r.id and a.charge_id=c.id);
  update public.condominium_bank_transactions t set status='reconciled',updated_at=now() where exists(select 1 from public.condominium_bank_matches m where m.bank_transaction_id=t.id and m.receipt_id=r.id and m.status='active');
  select * into e from public.condominium_journal_entries where id=e.id; insert into public.condominium_financial_events(condominio_id,event_type,entity_type,entity_id,actor_id) values(p_condominio_id,'reconciled','receipt',r.id,auth.uid()); return e;
end $$;

create function public.condominium_financial_reverse_receipt(p_condominio_id uuid,p_receipt_id uuid,p_period_id uuid,p_reason text,p_idempotency_key uuid)
returns public.condominium_journal_entries language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.condominium_receipts; original public.condominium_journal_entries; e public.condominium_journal_entries; l record;
begin
  perform public.condominium_financial_assert(p_condominio_id,true); perform public.condominium_financial_period_assert(p_condominio_id,p_period_id);
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'REVERSAL_REASON_REQUIRED'; end if;
  select * into r from public.condominium_receipts where id=p_receipt_id and condominio_id=p_condominio_id for update;
  select * into original from public.condominium_journal_entries where condominio_id=p_condominio_id and source_type='receipt' and source_id=r.id and status='posted' for update;
  if not found or r.status<>'reconciled' then raise exception 'RECEIPT_NOT_REVERSIBLE'; end if;
  insert into public.condominium_journal_entries(id,condominio_id,period_id,entry_date,event_type,source_type,source_id,reverses_entry_id,idempotency_key) values(gen_random_uuid(),p_condominio_id,p_period_id,current_date,'operation_reversed','receipt',r.id,original.id,p_idempotency_key) returning * into e;
  for l in select * from public.condominium_journal_lines where entry_id=original.id order by line_no loop
    insert into public.condominium_journal_lines(condominio_id,entry_id,line_no,account_code,bank_account_id,fund_id,unidad_id,charge_id,debit,credit) values(p_condominio_id,e.id,l.line_no,l.account_code,l.bank_account_id,l.fund_id,l.unidad_id,l.charge_id,l.credit,l.debit);
  end loop;
  perform public.condominium_financial_post_entry(e.id);
  update public.condominium_journal_entries set status='reversed' where id=original.id;
  update public.condominium_payment_applications set status='reversed',reversed_at=now(),reversal_entry_id=e.id where receipt_id=r.id and status='active';
  update public.condominium_charges c set status=case when coalesce((select sum(a.amount) from public.condominium_payment_applications a where a.charge_id=c.id and a.status='active'),0)=0 then 'open' else 'partially_paid' end,updated_at=now() where exists(select 1 from public.condominium_payment_applications a where a.receipt_id=r.id and a.charge_id=c.id);
  update public.condominium_bank_matches set status='reversed',reversed_at=now() where receipt_id=r.id and status='active';
  update public.condominium_receipts set status='reversed',reversed_at=now(),reversed_by=auth.uid(),reversal_reason=btrim(p_reason),updated_at=now() where id=r.id;
  insert into public.condominium_financial_events(condominio_id,event_type,entity_type,entity_id,actor_id,reason_code) values(p_condominio_id,'reversed','receipt',r.id,auth.uid(),'OPERATOR_CORRECTION'); select * into e from public.condominium_journal_entries where id=e.id; return e;
end $$;

create function public.condominium_financial_immutable_guard() returns trigger language plpgsql as $$ begin raise exception using errcode='42501',message='FINANCIAL_HISTORY_IS_APPEND_ONLY'; end $$;
create trigger financial_events_immutable before update or delete on public.condominium_financial_events for each row execute function public.condominium_financial_immutable_guard();
create trigger financial_lines_immutable before update or delete on public.condominium_journal_lines for each row execute function public.condominium_financial_immutable_guard();

create view public.condominium_financial_charge_balances with(security_invoker=true) as
select c.id,c.condominio_id,c.unidad_id,c.fund_id,c.amount,
 coalesce(sum(a.amount) filter(where a.status='active' and r.status='reconciled'),0)::numeric(14,2) applied_amount,
 (c.amount-coalesce(sum(a.amount) filter(where a.status='active' and r.status='reconciled'),0))::numeric(14,2) outstanding_amount
from public.condominium_charges c left join public.condominium_payment_applications a on a.charge_id=c.id left join public.condominium_receipts r on r.id=a.receipt_id group by c.id;

create view public.condominium_financial_ledger_balances with(security_invoker=true) as
select l.condominio_id,l.bank_account_id,l.fund_id,l.unidad_id,l.account_code,sum(l.debit-l.credit)::numeric(14,2) balance
from public.condominium_journal_lines l join public.condominium_journal_entries e on e.id=l.entry_id where e.status in ('posted','reversed') group by l.condominio_id,l.bank_account_id,l.fund_id,l.unidad_id,l.account_code;

do $$ declare t text; begin
 foreach t in array array['condominium_financial_controls','condominium_funds','condominium_bank_accounts','condominium_charge_concepts','condominium_financial_periods','condominium_charges','condominium_bank_transactions','condominium_receipts','condominium_payment_applications','condominium_bank_matches','condominium_reconciliations','condominium_financial_events','condominium_journal_entries','condominium_journal_lines'] loop
  execute format('alter table public.%I enable row level security',t); execute format('alter table public.%I force row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on table public.%I to authenticated,service_role',t);
  execute format('create policy %I on public.%I for select to authenticated using(public.condominium_internal_permission(''condominios'',false))',t||'_internal_select',t);
 end loop;
end $$;
grant select on public.condominium_financial_charge_balances,public.condominium_financial_ledger_balances to authenticated,service_role;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'condominium_financial_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
grant execute on function public.condominium_financial_create_charge(uuid,uuid,uuid,uuid,uuid,numeric,date,text,uuid) to authenticated;
grant execute on function public.condominium_financial_import_bank_transaction(uuid,uuid,uuid,date,date,text,numeric,text,text,text,uuid) to authenticated;
grant execute on function public.condominium_financial_identify_bank_transaction(uuid,uuid,uuid) to authenticated;
grant execute on function public.condominium_financial_create_receipt(uuid,uuid,uuid,date,numeric,text,text,text,uuid) to authenticated;
grant execute on function public.condominium_financial_apply_receipt(uuid,uuid,jsonb) to authenticated;
grant execute on function public.condominium_financial_match_bank_receipt(uuid,uuid,uuid,numeric,uuid) to authenticated;
grant execute on function public.condominium_financial_confirm_receipt(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.condominium_financial_reverse_receipt(uuid,uuid,uuid,text,uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('condominium-financial-evidence','condominium-financial-evidence',false,5242880,array['application/pdf','image/jpeg','image/png']::text[])
on conflict(id) do nothing;

comment on table public.condominium_financial_controls is 'Opt-in estricto: ausencia de fila o ledger_enabled=false bloquea toda mutación del nuevo motor.';
comment on table public.condominium_financial_events is 'Bitácora append-only del núcleo financiero; metadata no debe contener PII.';
comment on table public.condominium_journal_lines is 'Fuente de verdad de saldos; cada asiento publicado debe estar balanceado.';

commit;
