begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

-- The existing case is attempt 1. Never copy, reset or rewrite its evidence,
-- and retain UNIQUE(historical_turn_key, evaluation_runtime_version) unchanged.
create table public.shadow_historical_replay_attempts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.shadow_historical_replay_cases(id) on delete restrict,
  parent_attempt_id uuid,
  attempt_number integer not null check (attempt_number >= 2),
  attempt_ref text not null unique default replace(gen_random_uuid()::text, '-', ''),
  authorized_by uuid not null references public.profiles(id) on delete restrict,
  authorization_kind text not null check (authorization_kind = 'explicit_admin_retry'),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','running','completed','error')),
  operational_resolution jsonb,
  conversation_action text check (conversation_action is null or conversation_action in ('ask_missing_information','request_document','clarify_property','clarify_payment_amount','clarify_payment_period','acknowledge_received_information','provide_verified_status','human_handoff','no_message')),
  proposed_message text check (proposed_message is null or char_length(proposed_message) <= 480),
  result_safe jsonb,
  message_safe boolean,
  would_resolve_without_human boolean,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(12,6),
  latency_ms integer,
  error_code text,
  completed_at timestamptz,
  unique (case_id, attempt_number),
  unique (case_id, id),
  foreign key (case_id, parent_attempt_id) references public.shadow_historical_replay_attempts(case_id, id) on delete restrict,
  check ((attempt_number = 2 and parent_attempt_id is null) or (attempt_number > 2 and parent_attempt_id is not null))
);
create unique index shadow_replay_first_retry_once on public.shadow_historical_replay_attempts(case_id) where parent_attempt_id is null;
create unique index shadow_replay_child_once on public.shadow_historical_replay_attempts(parent_attempt_id) where parent_attempt_id is not null;
create index shadow_replay_attempt_actor on public.shadow_historical_replay_attempts(authorized_by);
alter table public.shadow_historical_replay_attempts enable row level security;
revoke all on public.shadow_historical_replay_attempts from public, anon, authenticated, service_role;
grant select on public.shadow_historical_replay_attempts to service_role;
grant update (status, operational_resolution, conversation_action, proposed_message, result_safe,
  message_safe, would_resolve_without_human, input_tokens, output_tokens, estimated_cost_usd,
  latency_ms, error_code, completed_at) on public.shadow_historical_replay_attempts to service_role;

-- Only this short transaction can create a child. No provider, natural run,
-- cohort creation, runtime override, or result from the parent is involved.
create function public.prepare_historical_replay_retry(p_case_id uuid, p_parent_attempt_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '3s' set statement_timeout = '10s'
as $$
declare
  original public.shadow_historical_replay_cases%rowtype;
  parent public.shadow_historical_replay_attempts%rowtype;
  child public.shadow_historical_replay_attempts%rowtype;
  next_number integer;
begin
  perform id from public.profiles where id = p_actor_id and active is true and role_id = 'admin' for share;
  if not found then raise exception 'admin_required'; end if;
  select * into original from public.shadow_historical_replay_cases where id = p_case_id for update;
  if not found then raise exception 'replay_case_not_found'; end if;
  if original.status <> 'error' then raise exception 'replay_retry_requires_error'; end if;
  if p_parent_attempt_id is null then
    next_number := 2;
  else
    select * into parent from public.shadow_historical_replay_attempts
      where id = p_parent_attempt_id and case_id = p_case_id for update;
    if not found then raise exception 'replay_parent_not_found'; end if;
    if parent.status <> 'error' then raise exception 'replay_retry_requires_error'; end if;
    next_number := parent.attempt_number + 1;
  end if;
  select * into child from public.shadow_historical_replay_attempts
    where case_id = p_case_id and parent_attempt_id is not distinct from p_parent_attempt_id;
  if found then
    return jsonb_build_object('id',child.id,'attemptRef',child.attempt_ref,'attemptNumber',child.attempt_number,'status',child.status,'created',false);
  end if;
  if exists(select 1 from public.shadow_historical_replay_attempts where case_id=p_case_id and attempt_number >= next_number) then
    raise exception 'replay_retry_not_latest';
  end if;
  insert into public.shadow_historical_replay_attempts(case_id,parent_attempt_id,attempt_number,authorized_by,authorization_kind)
    values(p_case_id,p_parent_attempt_id,next_number,p_actor_id,'explicit_admin_retry') returning * into child;
  return jsonb_build_object('id',child.id,'attemptRef',child.attempt_ref,'attemptNumber',child.attempt_number,'status',child.status,'created',true);
end;
$$;
revoke all on function public.prepare_historical_replay_retry(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.prepare_historical_replay_retry(uuid,uuid,uuid) to service_role;

-- Terminal attempts cannot be reset or have evidence replaced. Claiming a
-- pending child can change only status; terminalization uses the existing save.
create function public.guard_historical_replay_attempt() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'pending' and new.status = 'running' and (to_jsonb(old)-'status') = (to_jsonb(new)-'status') then return new; end if;
  if old.status = 'running' and new.status in ('completed','error') then
    if (to_jsonb(old) - array['status','operational_resolution','conversation_action','proposed_message','result_safe','message_safe','would_resolve_without_human','input_tokens','output_tokens','estimated_cost_usd','latency_ms','error_code','completed_at'])
      = (to_jsonb(new) - array['status','operational_resolution','conversation_action','proposed_message','result_safe','message_safe','would_resolve_without_human','input_tokens','output_tokens','estimated_cost_usd','latency_ms','error_code','completed_at']) then return new; end if;
  end if;
  raise exception 'replay_attempt_immutable_or_invalid_transition';
end;
$$;
revoke all on function public.guard_historical_replay_attempt() from public, anon, authenticated, service_role;
create trigger shadow_replay_attempt_transition before update on public.shadow_historical_replay_attempts
  for each row execute function public.guard_historical_replay_attempt();

create function public.guard_historical_replay_original() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.shadow_historical_replay_attempts where case_id=old.id) then
    raise exception 'replay_original_evidence_immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_historical_replay_original() from public, anon, authenticated, service_role;
create trigger shadow_replay_original_evidence before update or delete on public.shadow_historical_replay_cases
  for each row execute function public.guard_historical_replay_original();

comment on table public.shadow_historical_replay_attempts is 'Isolated explicit Replay retries (attempt 2+). Original case and terminal evidence are immutable. No natural runs or operational effects.';
commit;
