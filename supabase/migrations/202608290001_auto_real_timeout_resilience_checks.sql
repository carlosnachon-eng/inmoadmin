-- Read-only certification checks for Auto-Real durable deadline.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='shadow_ai_runs'
      and column_name='deadline_at' and data_type='timestamp with time zone'
  ) then raise exception 'shadow_ai_runs.deadline_at missing'; end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.shadow_ai_runs'::regclass
      and conname='shadow_ai_runs_deadline_after_start_check'
  ) then raise exception 'deadline constraint missing'; end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='shadow_ai_runs'
      and indexname='shadow_ai_runs_active_deadline_idx'
  ) then raise exception 'deadline index missing'; end if;
  if exists (select 1 from public.shadow_ai_runs where deadline_at is not null and deadline_at <= started_at) then
    raise exception 'invalid durable deadline';
  end if;
end $$;

select status, count(*) as runs, count(deadline_at) as runs_with_durable_deadline
from public.shadow_ai_runs group by status order by status;
