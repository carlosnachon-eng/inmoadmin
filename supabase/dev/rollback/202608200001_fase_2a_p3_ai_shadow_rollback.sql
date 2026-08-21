begin;
do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if col_description('public.shadow_ai_runs'::regclass, (select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname='idempotency_key')) is distinct from 'dev-bootstrap:202608200001:fase-2a-p3-ai-shadow' then raise exception 'P3 marker missing'; end if;
  if exists(select 1 from public.shadow_ai_runs where status <> 'not_executed') then raise exception 'P3 data exists; backup/cleanup required'; end if;
end $$;
drop index if exists public.shadow_ai_runs_idempotency_idx;
alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_status_check;
alter table public.shadow_ai_runs drop column if exists model, drop column if exists prompt_version, drop column if exists started_at, drop column if exists completed_at, drop column if exists latency_ms, drop column if exists input_tokens, drop column if exists output_tokens, drop column if exists estimated_cost_usd, drop column if exists error_sanitized, drop column if exists idempotency_key;
alter table public.shadow_ai_runs add constraint shadow_ai_runs_status_check check (status='not_executed');
alter table public.shadow_ai_decisions drop constraint if exists shadow_ai_decisions_status_check;
alter table public.shadow_ai_decisions drop column if exists intent, drop column if exists urgency, drop column if exists proposed_action, drop column if exists proposed_response, drop column if exists confidence, drop column if exists requires_human, drop column if exists escalation_reason, drop column if exists decision_json, drop column if exists tool_summary;
alter table public.shadow_ai_decisions add constraint shadow_ai_decisions_status_check check (status='not_executed');
alter table public.shadow_human_evaluations drop constraint if exists shadow_human_evaluations_classification_check;
alter table public.shadow_human_evaluations add constraint shadow_human_evaluations_classification_check check (classification in ('correct','partially_correct','incorrect','wrong_context','wrong_intent','not_administration'));
commit;
