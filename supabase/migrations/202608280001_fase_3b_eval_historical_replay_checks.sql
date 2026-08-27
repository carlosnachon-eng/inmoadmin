do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.shadow_historical_replay_cohorts'::regclass) then raise exception 'cohorts RLS required'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.shadow_historical_replay_cases'::regclass) then raise exception 'cases RLS required'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.shadow_historical_replay_reviews'::regclass) then raise exception 'reviews RLS required'; end if;
  if has_table_privilege('anon','public.shadow_historical_replay_cases','SELECT') or has_table_privilege('authenticated','public.shadow_historical_replay_cases','SELECT') then raise exception 'browser access must remain unavailable'; end if;
  if not has_table_privilege('service_role','public.shadow_historical_replay_cases','SELECT,INSERT,UPDATE') then raise exception 'case grants missing'; end if;
  if has_table_privilege('service_role','public.shadow_historical_replay_cases','DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'case destructive grants unavailable'; end if;
  if not has_table_privilege('service_role','public.shadow_historical_replay_reviews','SELECT,INSERT') then raise exception 'review grants missing'; end if;
  if has_table_privilege('service_role','public.shadow_historical_replay_reviews','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'reviews append-only'; end if;
end $$;
