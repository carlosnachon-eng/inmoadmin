begin;
do $$ begin
  if exists(select 1 from public.shadow_ai_runs where status<>'not_executed' or operational_event_id is not null) or exists(select 1 from public.shadow_ai_decisions where status<>'not_executed') then
    raise exception 'Rollback negado: existe auditoría P3; respaldar y diseñar procedimiento explícito';
  end if;
end $$;
drop index if exists public.shadow_ai_runs_operational_completed_uidx;
drop index if exists public.shadow_ai_runs_operational_event_idx;
drop index if exists public.shadow_ai_runs_qa_campaign_idx;
drop index if exists public.shadow_ai_runs_execution_state_updated_idx;
drop index if exists public.shadow_ai_runs_retry_of_idx;
drop index if exists public.shadow_ai_runs_idempotency_idx;
alter table public.shadow_ai_runs
  drop constraint if exists shadow_ai_runs_input_kind_check,
  drop constraint if exists shadow_ai_runs_qa_campaign_check,
  drop constraint if exists shadow_ai_runs_json_state_check,
  drop constraint if exists shadow_ai_runs_round_check,
  drop constraint if exists shadow_ai_runs_execution_state_check,
  drop constraint if exists shadow_ai_runs_status_check;
alter table public.shadow_ai_runs
  drop column operational_event_id, drop column input_kind, drop column campaign_id,
  drop column state_updated_at, drop column grounding_state_json, drop column tool_results_json,
  drop column evidence_ledger, drop column round_state_json, drop column schema_version,
  drop column max_rounds, drop column current_round, drop column execution_state,
  drop column telemetry_json, drop column attempt_number, drop column retry_of_run_id,
  drop column idempotency_key, drop column error_sanitized, drop column estimated_cost_usd,
  drop column output_tokens, drop column input_tokens, drop column latency_ms,
  drop column completed_at, drop column started_at, drop column prompt_version, drop column model;
alter table public.shadow_ai_runs alter column message_id set not null;
alter table public.shadow_ai_runs add constraint shadow_ai_runs_status_check check(status='not_executed');
alter table public.shadow_ai_decisions drop constraint if exists shadow_ai_decisions_status_check;
alter table public.shadow_ai_decisions
  drop column tool_summary, drop column decision_json, drop column escalation_reason,
  drop column requires_human, drop column confidence, drop column proposed_response,
  drop column proposed_action, drop column urgency, drop column intent;
alter table public.shadow_ai_decisions add constraint shadow_ai_decisions_status_check check(status='not_executed');
alter table public.shadow_human_evaluations drop constraint if exists shadow_human_evaluations_classification_check;
alter table public.shadow_human_evaluations add constraint shadow_human_evaluations_classification_check check(classification in ('correct','partially_correct','incorrect','wrong_context','wrong_intent','not_administration'));
commit;
