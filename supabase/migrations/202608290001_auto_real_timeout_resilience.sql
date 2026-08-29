-- Auto-Real: deadline durable por run. Sin seeds, backfill, outbound ni R1.
begin;

alter table public.shadow_ai_runs
  add column if not exists deadline_at timestamptz;

alter table public.shadow_ai_runs
  drop constraint if exists shadow_ai_runs_deadline_after_start_check,
  add constraint shadow_ai_runs_deadline_after_start_check
    check (deadline_at is null or deadline_at > started_at);

create index if not exists shadow_ai_runs_active_deadline_idx
  on public.shadow_ai_runs(deadline_at)
  where status = 'running';

comment on column public.shadow_ai_runs.deadline_at is
  'Immutable wall-clock deadline assigned when a new run is created; historical rows remain null and are never retried implicitly.';

commit;
