begin;
drop table if exists public.shadow_ai_explicit_retry_audit;
drop index if exists public.shadow_ai_runs_explicit_retry_once_uidx;
alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_explicit_retry_shape_check;
alter table public.shadow_ai_runs drop column if exists retry_authorized_at, drop column if exists retry_authorized_by, drop column if exists retry_runtime_version, drop column if exists retry_turn_key, drop column if exists retry_reason, drop column if exists parent_run_id;
commit;
