-- DEV-only: vincula runs P3 con Operational Events sin convertirlos en mensajes.
begin;
do $$ begin
  if to_regclass('public.shadow_ai_runs') is null or to_regclass('public.shadow_operational_events') is null then
    raise exception 'Dependencias Shadow P3/Operational Events ausentes';
  end if;
end $$;
alter table public.shadow_ai_runs alter column message_id drop not null;
alter table public.shadow_ai_runs add column if not exists operational_event_id uuid references public.shadow_operational_events(id) on delete restrict;
alter table public.shadow_ai_runs add column if not exists input_kind text not null default 'conversational_message';
alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_input_kind_check;
alter table public.shadow_ai_runs add constraint shadow_ai_runs_input_kind_check check (
  (input_kind='conversational_message' and message_id is not null and operational_event_id is null)
  or (input_kind='operational_event' and message_id is null and operational_event_id is not null)
);
create unique index if not exists shadow_ai_runs_operational_completed_uidx
  on public.shadow_ai_runs(operational_event_id,model,prompt_version)
  where operational_event_id is not null and status='completed';
create index if not exists shadow_ai_runs_operational_event_idx on public.shadow_ai_runs(operational_event_id,created_at desc) where operational_event_id is not null;
comment on column public.shadow_ai_runs.operational_event_id is 'dev-bootstrap:202608210003:p3-operational-input; stable operational identity';
comment on column public.shadow_ai_runs.input_kind is 'dev-bootstrap:202608210003:p3-operational-input; messages and operational events remain separate';
alter table public.shadow_ai_runs enable row level security;
revoke all on public.shadow_ai_runs from public,anon;
grant all on public.shadow_ai_runs to service_role;
commit;
