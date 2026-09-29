-- Separate PRODUCTION support artifact. Installation creates NO pilot or run.
-- Never use db push for this rollout. Explicit approval + exact-project preflight required.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
declare item record;
begin
  if to_regclass('public.shadow_manual_prod_turn_control') is not null
    or to_regclass('public.shadow_manual_prod_turn_message_refs') is not null
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (p.proname like '%manual_shadow_prod%' or p.proname like 'guard_manual_prod%'))
    then raise exception 'manual_prod_object_collision'; end if;
  for item in select * from (values
    ('profiles','id'),('profiles','role_id'),('profiles','active'),
    ('shadow_messages','id'),('shadow_messages','conversation_id'),('shadow_messages','provider'),('shadow_messages','direction'),
    ('shadow_conversations','provider'),('shadow_conversations','channel'),
    ('shadow_ai_manual_authorizations','authorization_id'),('shadow_ai_manual_authorizations','consumed_at'),('shadow_ai_manual_authorizations','ai_run_id'),
    ('shadow_ai_manual_authorizations','message_id'),('shadow_ai_manual_authorizations','authorized_by'),('shadow_ai_manual_authorizations','expires_at'),
    ('shadow_ai_manual_authorizations','revoked_at'),('shadow_ai_manual_authorizations','model'),('shadow_ai_manual_authorizations','prompt_version'),
    ('shadow_ai_runs','id'),('shadow_ai_runs','input_kind'),('shadow_ai_runs','operational_event_id'),('shadow_ai_runs','round_state_json'),('shadow_ai_runs','telemetry_json'),('shadow_ai_runs','max_rounds'),
    ('shadow_ai_runs','message_id'),('shadow_ai_runs','model'),('shadow_ai_runs','prompt_version'),('shadow_ai_runs','schema_version'),
    ('shadow_ai_runs','status'),('shadow_ai_runs','execution_state'),('shadow_ai_runs','started_at'),('shadow_ai_runs','deadline_at'),
    ('shadow_ai_runs','idempotency_key'),('shadow_ai_runs','attempt_number'),('shadow_ai_runs','current_round'),
    ('shadow_ai_decisions','ai_run_id'),('shadow_ai_decisions','decision_json'),
    ('shadow_conversation_actions','ai_run_id'),('shadow_conversation_actions','status'),('shadow_conversation_actions','turn_key'),
    ('shadow_admin_outbound_messages','conversation_action_id')) as required(tab,col)
  loop
    if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item.tab) and attname=item.col and not attisdropped)
      then raise exception 'manual_prod_schema_dependency: %.%',item.tab,item.col; end if;
  end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.shadow_ai_manual_authorizations'::regclass
    and contype='f' and confrelid='public.shadow_ai_runs'::regclass)
    or not exists(select 1 from pg_indexes where schemaname='public' and tablename='shadow_conversation_actions'
      and indexname='shadow_conversation_actions_turn_uidx') then raise exception 'manual_prod_base_constraint_missing'; end if;
  if exists(select 1 from public.shadow_ai_runs where prompt_version='manual-prod-one-turn-v1' or telemetry_json->>'input_mode'='manual_prod_one_turn')
    then raise exception 'manual_prod_existing_run_collision'; end if;
  if exists(select 1 from pg_locks l left join pg_stat_activity a on a.pid=l.pid
    where l.pid<>pg_backend_pid() and l.relation in ('public.shadow_ai_manual_authorizations'::regclass,'public.shadow_ai_runs'::regclass,
      'public.shadow_ai_decisions'::regclass,'public.shadow_conversation_actions'::regclass,'public.shadow_admin_outbound_messages'::regclass)
    and (not l.granted or l.mode in ('AccessExclusiveLock','ShareLock','ShareRowExclusiveLock') or a.xact_start<clock_timestamp()-interval '30 seconds'))
    then raise exception 'manual_prod_unacceptable_lock'; end if;
  if not has_table_privilege('service_role','public.profiles','SELECT') then raise exception 'manual_prod_base_grants_missing'; end if;
  for item in select tab,priv from (values ('shadow_ai_manual_authorizations'),('shadow_ai_runs')) as t(tab)
    cross join (values ('SELECT'),('INSERT'),('UPDATE')) as p(priv) loop
    if not has_table_privilege('service_role','public.'||item.tab,item.priv) then raise exception 'manual_prod_base_grants_missing'; end if;
  end loop;
end $$;

create table public.shadow_manual_prod_turn_control (
  pilot_key text primary key check (pilot_key='manual-prod-1of1-v1'),
  authorization_id uuid not null unique references public.shadow_ai_manual_authorizations(authorization_id) on delete restrict,
  run_id uuid unique references public.shadow_ai_runs(id) on delete restrict,
  turn_key text not null unique check(turn_key ~ '^[a-f0-9]{64}$'),
  source_fingerprint text not null check(source_fingerprint ~ '^[a-f0-9]{64}$'),
  input_snapshot jsonb not null check(jsonb_typeof(input_snapshot)='object'),
  runtime_sha text not null check(runtime_sha ~ '^[a-f0-9]{40}$'),
  deployment_id text not null check(deployment_id ~ '^dpl_[A-Za-z0-9]{10,80}$'),
  gates_at_authorization jsonb not null check (gates_at_authorization = '{"SHADOW_ADMIN_OUTBOUND_ENABLED":false,"SHADOW_OUTBOUND_ENABLED":false,"SHADOW_ADMIN_WORK_R1_ENABLED":false,"SHADOW_ADMIN_OUTBOUND_CANARY_ENABLED":false,"SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED":false,"SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED":false,"SHADOW_IDENTITY_CONFIRMATION_ENABLED":false,"SHADOW_AI_AUTO_REAL_ENABLED":false,"SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED":false,"SHADOW_AI_ENABLED":false,"SHADOW_AI_PRODUCTION_ENABLED":false,"SHADOW_AI_ALLOW_REAL_MESSAGES":false,"SHADOW_AI_MANUAL_REAL_ENABLED":false,"SHADOW_IDENTITY_LINK_REVIEW_WRITE_ENABLED":false,"SHADOW_AI_BACKFILL_REAL_ENABLED":false,"SHADOW_AI_ALLOW_OPERATIONAL_EVENTS":false,"SHADOW_AI_EXPLICIT_RETRY_ENABLED":false,"SHADOW_MANUAL_TURN_PRODUCTION_ENABLED":true,"SHADOW_MANUAL_TURN_DEV_ENABLED":false,"SHADOW_CONVERSATION_ACTIONS_ENABLED":true}'::jsonb),
  reserved_transmissions smallint not null default 0 check(reserved_transmissions between 0 and 2),
  created_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz check(closed_at>=created_at),
  check(run_id is not null or reserved_transmissions=0)
);
comment on table public.shadow_manual_prod_turn_control is 'manual-prod-1of1-v1: single lifetime pilot, private snapshot, no reset, no outbound; installation is empty';
alter table public.shadow_manual_prod_turn_control enable row level security;
revoke all on public.shadow_manual_prod_turn_control from public,anon,authenticated,service_role;
grant select,insert,update on public.shadow_manual_prod_turn_control to service_role;
create unique index shadow_manual_prod_run_once_idx on public.shadow_ai_runs((1))
  where prompt_version='manual-prod-one-turn-v1' or telemetry_json->>'input_mode'='manual_prod_one_turn';
create view public.shadow_manual_prod_turn_message_refs with (security_invoker=true) as
  select id,substring(encode(sha256(convert_to('manual-message:'||id::text,'UTF8')),'hex'),1,32) as message_ref from public.shadow_messages;
revoke all on public.shadow_manual_prod_turn_message_refs from public,anon,authenticated,service_role;
grant select on public.shadow_manual_prod_turn_message_refs to service_role;

-- Fixed trigger bodies read the private control without granting it to ordinary
-- table callers. Empty search_path; no dynamic SQL or caller-supplied identifiers.
create function public.guard_manual_prod_control() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP in ('DELETE','TRUNCATE') then raise exception 'manual_prod_evidence_preserved'; end if;
  if (to_jsonb(new)-array['closed_at','run_id','reserved_transmissions']) is distinct from (to_jsonb(old)-array['closed_at','run_id','reserved_transmissions'])
    or (old.closed_at is not null and new is distinct from old)
    or (old.run_id is not null and new.run_id is distinct from old.run_id)
    or new.reserved_transmissions<old.reserved_transmissions or new.reserved_transmissions>old.reserved_transmissions+1
    then raise exception 'manual_prod_control_immutable'; end if;
  if new.run_id is not null and not exists(select 1 from public.shadow_ai_manual_authorizations a where a.authorization_id=new.authorization_id
    and a.ai_run_id=new.run_id and a.consumed_at is not null) then raise exception 'manual_prod_link_invalid'; end if;
  if new.reserved_transmissions>old.reserved_transmissions and (new.closed_at is not null or not exists(
    select 1 from public.shadow_ai_runs r join public.shadow_ai_manual_authorizations a on a.ai_run_id=r.id
    where r.id=new.run_id and a.expires_at>clock_timestamp() and r.status='running' and r.execution_state='model_round_running'
      and r.deadline_at>clock_timestamp() and r.current_round+1=new.reserved_transmissions)) then raise exception 'manual_prod_round_not_reservable'; end if;
  return new;
end $$;
create trigger shadow_manual_prod_control_immutable before update or delete on public.shadow_manual_prod_turn_control for each row execute function public.guard_manual_prod_control();
create trigger shadow_manual_prod_control_no_truncate before truncate on public.shadow_manual_prod_turn_control for each statement execute function public.guard_manual_prod_control();

create function public.guard_manual_prod_authorization() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.shadow_manual_prod_turn_control;
begin
  select * into c from public.shadow_manual_prod_turn_control where authorization_id=old.authorization_id;
  if not found then if TG_OP='DELETE' then return old; else return new; end if; end if;
  if TG_OP='DELETE' then raise exception 'manual_prod_evidence_preserved'; end if;
  if (to_jsonb(new)-array['consumed_at','ai_run_id','revoked_at']) is distinct from (to_jsonb(old)-array['consumed_at','ai_run_id','revoked_at'])
    or (old.consumed_at is not null and new is distinct from old)
    or (old.revoked_at is not null and new is distinct from old) then raise exception 'manual_prod_authorization_immutable'; end if;
  if new.consumed_at is not null and (c.closed_at is not null or new.expires_at<=clock_timestamp() or not exists(
    select 1 from public.shadow_ai_runs r where r.id=new.ai_run_id and r.message_id=new.message_id and r.prompt_version='manual-prod-one-turn-v1'
      and r.telemetry_json->>'input_mode'='manual_prod_one_turn' and r.status='running' and r.current_round=0)) then raise exception 'manual_prod_claim_invalid'; end if;
  return new;
end $$;
create trigger shadow_manual_prod_authorization_guard before update or delete on public.shadow_ai_manual_authorizations for each row execute function public.guard_manual_prod_authorization();

create function public.guard_manual_prod_run() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.shadow_manual_prod_turn_control; a public.shadow_ai_manual_authorizations;
begin
  if TG_OP='INSERT' then
    if new.prompt_version is distinct from 'manual-prod-one-turn-v1' and new.telemetry_json->>'input_mode' is distinct from 'manual_prod_one_turn' then return new; end if;
    select * into c from public.shadow_manual_prod_turn_control where pilot_key='manual-prod-1of1-v1' for update;
    if not found or c.run_id is not null or c.closed_at is not null then raise exception 'manual_prod_run_not_authorized'; end if;
    select * into a from public.shadow_ai_manual_authorizations where authorization_id=c.authorization_id;
    if a.consumed_at is not null or a.revoked_at is not null or a.expires_at<=clock_timestamp()
      or new.message_id is distinct from a.message_id or new.model is distinct from a.model
      or new.prompt_version is distinct from 'manual-prod-one-turn-v1' or new.telemetry_json->>'input_mode' is distinct from 'manual_prod_one_turn'
      or new.round_state_json->'inputSnapshot' is distinct from c.input_snapshot
      or new.telemetry_json->>'turn_key' is distinct from c.turn_key
      or new.idempotency_key is distinct from 'manual-prod-turn:'||c.turn_key
      or new.max_rounds is distinct from 2 or new.current_round is distinct from 0 or new.attempt_number is distinct from 1
      or to_jsonb(new)->>'retry_of_run_id' is not null or to_jsonb(new)->>'parent_run_id' is not null
      or new.input_kind is distinct from 'conversational_message' or new.operational_event_id is not null
      or new.status is distinct from 'running' or new.execution_state is distinct from 'created'
      then raise exception 'manual_prod_run_not_authorized'; end if;
    return new;
  end if;
  select * into c from public.shadow_manual_prod_turn_control where run_id=old.id;
  if not found then
    if TG_OP='UPDATE' and (new.prompt_version='manual-prod-one-turn-v1' or new.telemetry_json->>'input_mode'='manual_prod_one_turn')
      then raise exception 'manual_prod_run_reassignment_forbidden'; end if;
    if TG_OP='DELETE' then return old; else return new; end if;
  end if;
  if TG_OP='DELETE' then raise exception 'manual_prod_evidence_preserved'; end if;
  if old.status<>'running' and new is distinct from old then raise exception 'manual_prod_terminal_immutable'; end if;
  if new.id is distinct from old.id or new.message_id is distinct from old.message_id or new.model is distinct from old.model
    or new.prompt_version is distinct from old.prompt_version or new.schema_version is distinct from old.schema_version
    or new.idempotency_key is distinct from old.idempotency_key or new.max_rounds is distinct from 2
    or new.input_kind is distinct from old.input_kind or new.operational_event_id is distinct from old.operational_event_id
    or new.started_at is distinct from old.started_at or new.deadline_at is distinct from old.deadline_at
    or new.round_state_json->'inputSnapshot' is distinct from c.input_snapshot
    or new.telemetry_json->>'input_mode' is distinct from 'manual_prod_one_turn'
    or new.telemetry_json->>'turn_key' is distinct from c.turn_key
    or new.current_round<old.current_round or new.current_round>2
    or new.attempt_number is distinct from 1 or to_jsonb(new)->>'retry_of_run_id' is not null or to_jsonb(new)->>'parent_run_id' is not null
    then raise exception 'manual_prod_run_immutable'; end if;
  return new;
end $$;
create trigger shadow_manual_prod_run_guard before insert or update or delete on public.shadow_ai_runs for each row execute function public.guard_manual_prod_run();

create function public.guard_manual_prod_action() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.shadow_manual_prod_turn_control c where c.run_id=new.ai_run_id
    or (TG_OP<>'INSERT' and c.run_id=old.ai_run_id)) then
    if TG_OP='DELETE' then raise exception 'manual_prod_evidence_preserved'; end if;
    if new.status in ('approved_for_future_auto','sent') then raise exception 'manual_prod_outbound_forbidden'; end if;
    if TG_OP='UPDATE' and new is distinct from old then raise exception 'manual_prod_action_immutable'; end if;
  end if;
  if TG_OP='DELETE' then return old; else return new; end if;
end $$;
create trigger shadow_manual_prod_action_human_gate before insert or update or delete on public.shadow_conversation_actions for each row execute function public.guard_manual_prod_action();

create function public.guard_manual_prod_decision() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.shadow_manual_prod_turn_control c where c.run_id=old.ai_run_id or (TG_OP='UPDATE' and c.run_id=new.ai_run_id))
    then raise exception 'manual_prod_evidence_preserved'; end if;
  if TG_OP='DELETE' then return old; else return new; end if;
end $$;
create trigger shadow_manual_prod_decision_immutable before update or delete on public.shadow_ai_decisions for each row execute function public.guard_manual_prod_decision();

create function public.guard_manual_prod_sender() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.shadow_conversation_actions a join public.shadow_manual_prod_turn_control c on c.run_id=a.ai_run_id
    where a.id=new.conversation_action_id) then raise exception 'manual_prod_outbound_forbidden'; end if;
  return new;
end $$;
create trigger shadow_manual_prod_sender_gate before insert or update on public.shadow_admin_outbound_messages for each row execute function public.guard_manual_prod_sender();

create function public.authorize_manual_shadow_prod_turn(p_message_id uuid,p_actor_id uuid,p_turn_key text,p_fingerprint text,p_snapshot jsonb,p_model text,p_runtime_sha text,p_deployment_id text,p_gates jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.shadow_manual_prod_turn_control; a public.shadow_ai_manual_authorizations;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and active=true and role_id='admin') then raise exception 'admin_required'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or p_snapshot->>'provider' is distinct from 'respond_admin' or p_snapshot->>'direction' is distinct from 'inbound'
    or p_snapshot#>>'{providerMetadata,channelId}' is distinct from '544519'
    or p_snapshot#>>'{providerMetadata,conversationTurn,turnKey}' is distinct from p_turn_key
    or not exists(select 1 from public.shadow_messages m join public.shadow_conversations conv on conv.id=m.conversation_id
      where m.id=p_message_id and m.provider='respond_admin' and m.direction='inbound' and conv.provider='respond_admin' and conv.channel='544519')
    then raise exception 'manual_input_changed'; end if;
  perform pg_advisory_xact_lock(hashtextextended('manual-prod-1of1-v1',0));
  select * into c from public.shadow_manual_prod_turn_control where pilot_key='manual-prod-1of1-v1' for update;
  if found then
    select * into a from public.shadow_ai_manual_authorizations where authorization_id=c.authorization_id;
    if c.closed_at is not null or a.consumed_at is not null or a.revoked_at is not null or a.expires_at<=clock_timestamp() then raise exception 'manual_prod_not_renewable'; end if;
    if a.message_id is distinct from p_message_id or a.authorized_by is distinct from p_actor_id or c.turn_key is distinct from p_turn_key
      or c.source_fingerprint is distinct from p_fingerprint or c.input_snapshot is distinct from p_snapshot or a.model is distinct from p_model
      or c.runtime_sha is distinct from p_runtime_sha or c.deployment_id is distinct from p_deployment_id or c.gates_at_authorization is distinct from p_gates
      then raise exception 'manual_prod_pilot_exists'; end if;
    return jsonb_build_object('authorization_id',a.authorization_id,'created',false);
  end if;
  if exists(select 1 from public.shadow_ai_runs where message_id=p_message_id)
    or exists(select 1 from public.shadow_conversation_actions where turn_key=p_turn_key) then raise exception 'manual_prod_existing_evidence'; end if;
  insert into public.shadow_ai_manual_authorizations(message_id,authorized_by,expires_at,model,prompt_version)
    values(p_message_id,p_actor_id,clock_timestamp()+interval '10 minutes',p_model,'manual-prod-one-turn-v1') returning * into a;
  insert into public.shadow_manual_prod_turn_control(pilot_key,authorization_id,turn_key,source_fingerprint,input_snapshot,runtime_sha,deployment_id,gates_at_authorization)
    values('manual-prod-1of1-v1',a.authorization_id,p_turn_key,p_fingerprint,p_snapshot,p_runtime_sha,p_deployment_id,p_gates);
  return jsonb_build_object('authorization_id',a.authorization_id,'created',true);
end $$;

create function public.claim_manual_shadow_prod_turn(p_authorization_id uuid,p_actor_id uuid,p_fingerprint text,p_runtime_sha text,p_deployment_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.shadow_manual_prod_turn_control; a public.shadow_ai_manual_authorizations; r uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and active=true and role_id='admin') then raise exception 'admin_required'; end if;
  select * into c from public.shadow_manual_prod_turn_control where authorization_id=p_authorization_id for update;
  if not found then raise exception 'manual_authorization_invalid'; end if;
  select * into a from public.shadow_ai_manual_authorizations where authorization_id=p_authorization_id for update;
  if a.authorized_by is distinct from p_actor_id then raise exception 'admin_required'; end if;
  if c.runtime_sha is distinct from p_runtime_sha or c.deployment_id is distinct from p_deployment_id then raise exception 'manual_prod_runtime_mismatch'; end if;
  if a.consumed_at is not null then return jsonb_build_object('run_id',a.ai_run_id,'claimed',false); end if;
  if c.closed_at is not null or a.revoked_at is not null then raise exception 'manual_prod_closed'; end if;
  if a.expires_at<=clock_timestamp() then raise exception 'manual_prod_expired'; end if;
  if c.source_fingerprint is distinct from p_fingerprint then raise exception 'manual_input_changed'; end if;
  insert into public.shadow_ai_runs(message_id,status,execution_state,model,prompt_version,schema_version,started_at,deadline_at,idempotency_key,attempt_number,current_round,max_rounds,round_state_json,telemetry_json)
    values(a.message_id,'running','created',a.model,'manual-prod-one-turn-v1','manual-reduced-v1',clock_timestamp(),clock_timestamp()+interval '105 seconds',
      'manual-prod-turn:'||c.turn_key,1,0,2,jsonb_build_object('inputSnapshot',c.input_snapshot,'rounds','[]'::jsonb),
      jsonb_build_object('input_mode','manual_prod_one_turn','turn_key',c.turn_key,'turn_message_ids',c.input_snapshot#>'{providerMetadata,conversationTurn,messageIds}')) returning id into r;
  update public.shadow_ai_manual_authorizations set consumed_at=clock_timestamp(),ai_run_id=r where authorization_id=p_authorization_id;
  update public.shadow_manual_prod_turn_control set run_id=r where authorization_id=p_authorization_id;
  return jsonb_build_object('run_id',r,'claimed',true);
end $$;

create function public.reserve_manual_shadow_prod_round(p_authorization_id uuid,p_actor_id uuid,p_run_id uuid,p_round integer,p_fingerprint text,p_runtime_sha text,p_deployment_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.shadow_manual_prod_turn_control; a public.shadow_ai_manual_authorizations;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and active=true and role_id='admin') then raise exception 'admin_required'; end if;
  select * into c from public.shadow_manual_prod_turn_control where authorization_id=p_authorization_id for update;
  if not found then raise exception 'manual_authorization_invalid'; end if;
  select * into a from public.shadow_ai_manual_authorizations where authorization_id=p_authorization_id;
  if a.authorized_by is distinct from p_actor_id or c.run_id is distinct from p_run_id or a.ai_run_id is distinct from p_run_id or a.consumed_at is null then raise exception 'manual_prod_link_invalid'; end if;
  if c.closed_at is not null or a.revoked_at is not null then raise exception 'manual_prod_closed'; end if;
  if a.expires_at<=clock_timestamp() then raise exception 'manual_prod_expired'; end if;
  if c.runtime_sha is distinct from p_runtime_sha or c.deployment_id is distinct from p_deployment_id then raise exception 'manual_prod_runtime_mismatch'; end if;
  if c.source_fingerprint is distinct from p_fingerprint then raise exception 'manual_input_changed'; end if;
  if p_round is null or p_round not between 1 and 2 then raise exception 'manual_prod_transmission_limit'; end if;
  if p_round<>c.reserved_transmissions+1 then raise exception 'manual_prod_reservation_reused'; end if;
  update public.shadow_manual_prod_turn_control set reserved_transmissions=p_round where authorization_id=p_authorization_id;
  return jsonb_build_object('reserved',true,'round',p_round);
end $$;

create function public.close_manual_shadow_prod_turn(p_authorization_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.shadow_manual_prod_turn_control;
begin
  -- Any currently active admin can CLOSE; only the author can claim/execute.
  if not exists(select 1 from public.profiles where id=p_actor_id and active=true and role_id='admin') then raise exception 'admin_required'; end if;
  select * into c from public.shadow_manual_prod_turn_control where authorization_id=p_authorization_id for update;
  if not found then raise exception 'manual_authorization_invalid'; end if;
  if c.closed_at is null then update public.shadow_manual_prod_turn_control set closed_at=clock_timestamp() where authorization_id=p_authorization_id returning * into c; end if;
  return jsonb_build_object('closed',true,'closed_at',c.closed_at);
end $$;

-- No role creation or grant changes on existing tables; all four RPCs are server-only.
revoke all on function public.authorize_manual_shadow_prod_turn(uuid,uuid,text,text,jsonb,text,text,text,jsonb),
  public.claim_manual_shadow_prod_turn(uuid,uuid,text,text,text), public.reserve_manual_shadow_prod_round(uuid,uuid,uuid,integer,text,text,text),
  public.close_manual_shadow_prod_turn(uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_manual_shadow_prod_turn(uuid,uuid,text,text,jsonb,text,text,text,jsonb),
  public.claim_manual_shadow_prod_turn(uuid,uuid,text,text,text), public.reserve_manual_shadow_prod_round(uuid,uuid,uuid,integer,text,text,text),
  public.close_manual_shadow_prod_turn(uuid,uuid) to service_role;
revoke all on function public.guard_manual_prod_control(),public.guard_manual_prod_authorization(),public.guard_manual_prod_run(),
  public.guard_manual_prod_action(),public.guard_manual_prod_decision(),public.guard_manual_prod_sender() from public,anon,authenticated;

do $$
declare f record; item record;
begin
  if not (select relrowsecurity from pg_class where oid='public.shadow_manual_prod_turn_control'::regclass)
    or has_table_privilege('anon','public.shadow_manual_prod_turn_control','SELECT')
    or has_table_privilege('authenticated','public.shadow_manual_prod_turn_control','SELECT')
    or has_table_privilege('service_role','public.shadow_manual_prod_turn_control','DELETE')
    or has_table_privilege('service_role','public.shadow_manual_prod_turn_control','TRUNCATE')
    then raise exception 'manual_prod_acl_check_failed'; end if;
  for item in select priv from (values ('SELECT'),('INSERT'),('UPDATE')) as p(priv) loop
    if not has_table_privilege('service_role','public.shadow_manual_prod_turn_control',item.priv) then raise exception 'manual_prod_acl_check_failed'; end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid='public.shadow_manual_prod_turn_control'::regclass and contype='f'
    and confrelid in ('public.shadow_ai_manual_authorizations'::regclass,'public.shadow_ai_runs'::regclass))<>2
    or (select count(*) from pg_constraint where conrelid='public.shadow_manual_prod_turn_control'::regclass and contype in ('u','p'))<>4
    or not exists(select 1 from pg_index where indexrelid='public.shadow_manual_prod_run_once_idx'::regclass and indisunique and indisvalid)
    then raise exception 'manual_prod_constraints_check_failed'; end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in
    ('authorize_manual_shadow_prod_turn','claim_manual_shadow_prod_turn','reserve_manual_shadow_prod_round','close_manual_shadow_prod_turn'))<>4 then raise exception 'manual_prod_rpc_check_failed'; end if;
  for f in select oid,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in
    ('authorize_manual_shadow_prod_turn','claim_manual_shadow_prod_turn','reserve_manual_shadow_prod_round','close_manual_shadow_prod_turn') loop
    if f.prosecdef or not ('search_path=""'=any(f.proconfig)) or has_function_privilege('anon',f.oid,'EXECUTE')
      or has_function_privilege('authenticated',f.oid,'EXECUTE') or not has_function_privilege('service_role',f.oid,'EXECUTE') then raise exception 'manual_prod_rpc_check_failed'; end if;
  end loop;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in
    ('shadow_manual_prod_control_immutable','shadow_manual_prod_control_no_truncate','shadow_manual_prod_authorization_guard','shadow_manual_prod_run_guard',
     'shadow_manual_prod_action_human_gate','shadow_manual_prod_decision_immutable','shadow_manual_prod_sender_gate') and tgenabled='O')<>7 then raise exception 'manual_prod_trigger_check_failed'; end if;
  if exists(select 1 from public.shadow_manual_prod_turn_control) then raise exception 'manual_prod_install_must_be_empty'; end if;
  if has_table_privilege('anon','public.shadow_manual_prod_turn_message_refs','SELECT')
    or has_table_privilege('authenticated','public.shadow_manual_prod_turn_message_refs','SELECT')
    or not has_table_privilege('service_role','public.shadow_manual_prod_turn_message_refs','SELECT')
    or not(select 'security_invoker=true'=any(reloptions) from pg_class where oid='public.shadow_manual_prod_turn_message_refs'::regclass) then raise exception 'manual_prod_view_check_failed'; end if;
end $$;
commit;
