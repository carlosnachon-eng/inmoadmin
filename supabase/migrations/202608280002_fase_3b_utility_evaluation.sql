alter table public.shadow_historical_replay_reviews
  add column if not exists human_auto_send_eligible boolean,
  add column if not exists comment_safe text,
  add column if not exists review_schema_version text not null default 'v1';

alter table public.shadow_historical_replay_reviews drop constraint if exists shadow_historical_replay_reviews_reason_check;
alter table public.shadow_historical_replay_reviews add constraint shadow_historical_replay_reviews_reason_check check (
  reason is null or reason = any (array['tone','missing_information','wrong_question','requested_existing_document','invented_fact','incorrect_context','unnecessary_escalation','financial_risk','legal_risk','should_have_asked','should_have_stayed_silent','other'])
);
alter table public.shadow_historical_replay_reviews add constraint shadow_historical_replay_reviews_v2_check check (
  review_schema_version = 'v1' or (review_schema_version = 'v2' and human_auto_send_eligible is not null
    and (rating = 'correct' or reason is not null) and (comment_safe is null or char_length(comment_safe) <= 500))
);

revoke all on public.shadow_historical_replay_reviews from public, anon, authenticated, service_role;
grant select, insert on public.shadow_historical_replay_reviews to service_role;
