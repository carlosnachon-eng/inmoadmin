begin;
do $$ begin
  if exists(select 1 from public.shadow_ai_runs where operational_event_id is not null) then raise exception 'Rollback negado: existen runs operativos'; end if;
end $$;
drop index if exists public.shadow_ai_runs_operational_completed_uidx;
drop index if exists public.shadow_ai_runs_operational_event_idx;
alter table public.shadow_ai_runs drop constraint if exists shadow_ai_runs_input_kind_check;
alter table public.shadow_ai_runs drop column if exists operational_event_id;
alter table public.shadow_ai_runs drop column if exists input_kind;
alter table public.shadow_ai_runs alter column message_id set not null;
commit;
