-- Not executed automatically. Removes only the durable deadline artifacts.
begin;
drop index if exists public.shadow_ai_runs_active_deadline_idx;
alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_deadline_after_start_check;
alter table public.shadow_ai_runs drop column if exists deadline_at;
commit;
