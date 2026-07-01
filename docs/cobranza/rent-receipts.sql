create table if not exists public.rent_receipts (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique,
  payment_id uuid not null references public.payments(id) on delete cascade,
  contract_id uuid references public.contracts(id) on delete set null,
  property_name text,
  tenant_name text,
  tenant_email text,
  owner_name text,
  period_label text,
  amount numeric not null default 0,
  status text not null default 'emitido' check (status in ('emitido', 'cobrado', 'cancelado')),
  pdf_url text,
  variant text not null default 'impreso' check (variant in ('impreso', 'digital')),
  issued_by text,
  issued_at timestamptz not null default now(),
  collected_by text,
  collected_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rent_receipts_payment on public.rent_receipts(payment_id);
create index if not exists idx_rent_receipts_status on public.rent_receipts(status);
create index if not exists idx_rent_receipts_issued_at on public.rent_receipts(issued_at desc);

alter table public.rent_receipts enable row level security;

drop policy if exists rent_receipts_no_direct_access on public.rent_receipts;
create policy rent_receipts_no_direct_access
on public.rent_receipts
for all
using (false)
with check (false);
