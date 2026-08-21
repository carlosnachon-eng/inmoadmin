begin;
do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if col_description('public.shadow_ai_runs'::regclass, (select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname='campaign_id' and not attisdropped)) not like 'dev-bootstrap:202608200005:%' then raise exception 'campaign_id not owned by this bootstrap'; end if;
  if exists(select 1 from public.shadow_ai_runs where campaign_id is not null) then raise exception 'QA campaign audit exists; preserve it and do not rollback'; end if;
end $$;
drop index if exists public.shadow_ai_runs_qa_campaign_idx;
alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_qa_campaign_check;
alter table public.shadow_ai_runs drop column campaign_id;
commit;
