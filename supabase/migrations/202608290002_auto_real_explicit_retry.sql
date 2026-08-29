-- Retry administrativo explícito de un run terminal. Sin seeds, backfill, outbound ni R1.
begin;

alter table public.shadow_ai_runs
  add column if not exists parent_run_id uuid references public.shadow_ai_runs(id) on delete restrict,
  add column if not exists retry_reason text,
  add column if not exists retry_turn_key text,
  add column if not exists retry_runtime_version text,
  add column if not exists retry_authorized_by uuid references public.profiles(id) on delete restrict,
  add column if not exists retry_authorized_at timestamptz;

alter table public.shadow_ai_runs
  add constraint shadow_ai_runs_explicit_retry_shape_check check (
    (parent_run_id is null and retry_reason is null and retry_turn_key is null and retry_runtime_version is null and retry_authorized_by is null and retry_authorized_at is null)
    or
    (parent_run_id is not null and retry_reason = 'explicit_user_authorized' and retry_turn_key ~ '^[a-f0-9]{64}$' and char_length(retry_runtime_version) between 8 and 100 and retry_authorized_by is not null and retry_authorized_at is not null and retry_of_run_id = parent_run_id)
  );

create unique index shadow_ai_runs_explicit_retry_once_uidx
  on public.shadow_ai_runs(parent_run_id, retry_turn_key, retry_runtime_version)
  where parent_run_id is not null;

create table public.shadow_ai_explicit_retry_audit (
  id uuid primary key default gen_random_uuid(),
  parent_run_id uuid not null references public.shadow_ai_runs(id) on delete restrict,
  child_run_id uuid references public.shadow_ai_runs(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  event_type text not null check (event_type in ('blocked','executed')),
  reason_code text not null check (reason_code ~ '^[a-z0-9_:-]{1,80}$'),
  runtime_version text not null check (char_length(runtime_version) between 8 and 100),
  turn_key text check (turn_key is null or turn_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

alter table public.shadow_ai_explicit_retry_audit enable row level security;
revoke all on public.shadow_ai_explicit_retry_audit from public, anon, authenticated, service_role;
grant select, insert on public.shadow_ai_explicit_retry_audit to service_role;

comment on table public.shadow_ai_explicit_retry_audit is 'Append-only, sin contenido ni PII; autorización y resultado del retry Auto-Real explícito.';
comment on column public.shadow_ai_runs.parent_run_id is 'Parent terminal inmutable para retry administrativo explícito.';

commit;
