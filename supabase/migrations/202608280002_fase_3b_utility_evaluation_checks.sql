do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='shadow_historical_replay_reviews' and column_name='human_auto_send_eligible') then raise exception 'human eligibility missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='shadow_historical_replay_reviews' and column_name='comment_safe') then raise exception 'safe comment missing'; end if;
  if not has_table_privilege('service_role','public.shadow_historical_replay_reviews','SELECT,INSERT') then raise exception 'review grants missing'; end if;
  if has_table_privilege('service_role','public.shadow_historical_replay_reviews','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'reviews must remain append-only'; end if;
  if has_table_privilege('anon','public.shadow_historical_replay_reviews','SELECT') or has_table_privilege('authenticated','public.shadow_historical_replay_reviews','SELECT') then raise exception 'browser access forbidden'; end if;
end $$;
