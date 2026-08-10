begin;

create table if not exists public.gv_respond_sync_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('running', 'completed', 'failed', 'cancelled')),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  current_cursor text,
  last_confirmed_cursor text,
  batch_number integer not null default 0,
  contacts_processed integer not null default 0,
  snapshots_upserted integer not null default 0,
  snapshots_created integer not null default 0,
  snapshots_updated integer not null default 0,
  contacts_ignored_outside_sales integer not null default 0,
  contacts_excluded_area_conflict integer not null default 0,
  message_requests integer not null default 0,
  coverage_complete boolean not null default false,
  stopped_reason text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists gv_respond_sync_runs_one_active
on public.gv_respond_sync_runs ((status))
where status = 'running';

create index if not exists gv_respond_sync_runs_started_at_idx
on public.gv_respond_sync_runs (started_at desc);

alter table public.gv_respond_sync_runs enable row level security;

drop policy if exists gv_respond_sync_runs_select_management on public.gv_respond_sync_runs;
create policy gv_respond_sync_runs_select_management
on public.gv_respond_sync_runs
for select
to authenticated
using (
  public.current_profile_role_id() in ('admin', 'gerente_ventas')
);

drop policy if exists gv_respond_sync_runs_write_service on public.gv_respond_sync_runs;
create policy gv_respond_sync_runs_write_service
on public.gv_respond_sync_runs
for all
to service_role
using (true)
with check (true);

grant select on public.gv_respond_sync_runs to authenticated;
grant all on public.gv_respond_sync_runs to service_role;

commit;
