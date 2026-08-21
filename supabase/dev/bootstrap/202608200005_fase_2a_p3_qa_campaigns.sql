begin;
do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if obj_description('public.shadow_ai_runs'::regclass) not like 'dev-bootstrap:202608180005:%' then raise exception 'P0 DEV marker missing'; end if;
  if col_description('public.shadow_ai_runs'::regclass, (select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname='execution_state' and not attisdropped)) not like 'dev-bootstrap:202608200004:%' then raise exception 'P3 state-machine DEV marker missing'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='campaign_id' and (udt_name <> 'text' or is_nullable <> 'YES')) then raise exception 'Incompatible campaign_id'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='campaign_id')
     and col_description('public.shadow_ai_runs'::regclass, (select attnum from pg_attribute where attrelid='public.shadow_ai_runs'::regclass and attname='campaign_id' and not attisdropped)) is distinct from 'dev-bootstrap:202608200005:fase-2a-p3-qa-campaigns; nullable and restricted to synthetic DEV QA' then raise exception 'Pre-existing campaign_id is not owned by this bootstrap'; end if;
end $$;

alter table public.shadow_ai_runs add column if not exists campaign_id text;

do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='campaign_id' and (udt_name <> 'text' or is_nullable <> 'YES')) then raise exception 'Incompatible campaign_id definition'; end if;
end $$;

alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_qa_campaign_check;
alter table public.shadow_ai_runs add constraint shadow_ai_runs_qa_campaign_check
  check (campaign_id is null or (campaign_id ~ '^p3-[a-z0-9]+(-[a-z0-9]+)*$' and length(campaign_id) <= 80));
create index if not exists shadow_ai_runs_qa_campaign_idx
  on public.shadow_ai_runs(campaign_id, model, prompt_version, message_id, created_at desc)
  where campaign_id is not null;
comment on column public.shadow_ai_runs.campaign_id is 'dev-bootstrap:202608200005:fase-2a-p3-qa-campaigns; nullable and restricted to synthetic DEV QA';

alter table public.shadow_ai_runs enable row level security;
revoke all on public.shadow_ai_runs from public, anon;
grant all on public.shadow_ai_runs to service_role;
commit;
