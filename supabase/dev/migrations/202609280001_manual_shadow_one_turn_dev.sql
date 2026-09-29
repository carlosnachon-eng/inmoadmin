-- Additive DEV certification only. No data migration, capture, backfill or AI.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter table public.shadow_ai_manual_authorizations
  add column manual_turn_key text,
  add column manual_source_fingerprint text,
  add column manual_input_snapshot jsonb,
  add constraint manual_turn_authorization_snapshot_check check (
    (manual_turn_key is null and manual_source_fingerprint is null and manual_input_snapshot is null)
    or (manual_turn_key is not null and manual_source_fingerprint is not null and manual_input_snapshot is not null
      and manual_turn_key ~ '^[a-f0-9]{64}$' and manual_source_fingerprint ~ '^[a-f0-9]{64}$'
      and jsonb_typeof(manual_input_snapshot)='object' and prompt_version='manual-dev-one-turn-v1'));
create unique index shadow_manual_turn_once_idx on public.shadow_ai_manual_authorizations(manual_turn_key) where manual_turn_key is not null;

-- Selected reference lookup only; the API never scans or automatically picks.
create view public.shadow_manual_turn_message_refs with (security_invoker=true) as
  select id, substring(encode(sha256(convert_to('manual-message:' || id::text,'UTF8')),'hex'),1,32) as message_ref
  from public.shadow_messages;
revoke all on public.shadow_manual_turn_message_refs from public,anon,authenticated;
grant select on public.shadow_manual_turn_message_refs to service_role;

create function public.authorize_manual_shadow_turn(p_message_id uuid,p_actor_id uuid,p_turn_key text,p_fingerprint text,p_snapshot jsonb,p_model text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.shadow_ai_manual_authorizations;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and active=true and role_id='admin') then raise exception 'admin_required'; end if;
  if p_turn_key is null or p_fingerprint is null or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
    or p_snapshot->>'provider'<>'respond_admin' or p_snapshot->>'direction'<>'inbound'
    or p_snapshot#>>'{providerMetadata,channelId}'<>'544519'
    or p_snapshot#>>'{providerMetadata,conversationTurn,turnKey}' is distinct from p_turn_key
    or not exists(select 1 from public.shadow_messages m join public.shadow_conversations c on c.id=m.conversation_id
      where m.id=p_message_id and m.provider='respond_admin' and m.direction='inbound' and c.provider='respond_admin' and c.channel='544519')
  then raise exception 'manual_input_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('manual-turn:' || p_turn_key,0));
  select * into a from public.shadow_ai_manual_authorizations where manual_turn_key=p_turn_key for update;
  if found then
    if a.authorized_by<>p_actor_id or a.consumed_at is not null or a.revoked_at is not null or a.expires_at<=clock_timestamp()
      or a.manual_source_fingerprint<>p_fingerprint then raise exception 'manual_authorization_not_renewable'; end if;
    return jsonb_build_object('authorization_id',a.authorization_id,'created',false);
  end if;
  insert into public.shadow_ai_manual_authorizations(message_id,authorized_by,expires_at,model,prompt_version,manual_turn_key,manual_source_fingerprint,manual_input_snapshot)
    values(p_message_id,p_actor_id,clock_timestamp()+interval '10 minutes',p_model,'manual-dev-one-turn-v1',p_turn_key,p_fingerprint,p_snapshot)
    returning * into a;
  return jsonb_build_object('authorization_id',a.authorization_id,'created',true);
end $$;

create function public.claim_manual_shadow_turn(p_authorization_id uuid,p_actor_id uuid,p_fingerprint text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.shadow_ai_manual_authorizations; r uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and active=true and role_id='admin') then raise exception 'admin_required'; end if;
  select * into a from public.shadow_ai_manual_authorizations where authorization_id=p_authorization_id for update;
  if not found or a.manual_turn_key is null or a.authorized_by<>p_actor_id then raise exception 'manual_authorization_invalid'; end if;
  if a.consumed_at is not null then return jsonb_build_object('run_id',a.ai_run_id,'claimed',false); end if;
  if a.revoked_at is not null or a.expires_at<=clock_timestamp() or a.manual_source_fingerprint is distinct from p_fingerprint then raise exception 'manual_authorization_not_consumable'; end if;
  insert into public.shadow_ai_runs(message_id,status,execution_state,model,prompt_version,schema_version,started_at,deadline_at,
    idempotency_key,attempt_number,current_round,max_rounds,round_state_json,telemetry_json)
    values(a.message_id,'running','created',a.model,a.prompt_version,'manual-reduced-v1',clock_timestamp(),clock_timestamp()+interval '105 seconds',
      'manual-turn:'||a.manual_turn_key,1,0,2,jsonb_build_object('inputSnapshot',a.manual_input_snapshot,'rounds','[]'::jsonb),
      jsonb_build_object('input_mode','manual_dev_one_turn','turn_key',a.manual_turn_key,'turn_message_ids',a.manual_input_snapshot#>'{providerMetadata,conversationTurn,messageIds}'))
    returning id into r;
  update public.shadow_ai_manual_authorizations set consumed_at=clock_timestamp(),ai_run_id=r where authorization_id=a.authorization_id;
  return jsonb_build_object('run_id',r,'claimed',true);
end $$;
revoke all on function public.authorize_manual_shadow_turn(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.claim_manual_shadow_turn(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.authorize_manual_shadow_turn(uuid,uuid,text,text,jsonb,text) to service_role;
grant execute on function public.claim_manual_shadow_turn(uuid,uuid,text) to service_role;

-- Keep measured 3B eligibility intact, but never turn this manual evaluation
-- into an outbound authorization (including through existing sender RPCs).
create function public.guard_manual_shadow_action() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if (new.status in ('approved_for_future_auto','sent') or (TG_OP='UPDATE' and new.ai_run_id is distinct from old.ai_run_id))
    and exists(select 1 from public.shadow_ai_runs where id=case when TG_OP='UPDATE' then old.ai_run_id else new.ai_run_id end
      and telemetry_json->>'input_mode'='manual_dev_one_turn')
  then raise exception 'manual_turn_outbound_forbidden'; end if;
  return new;
end $$;
create trigger shadow_manual_turn_action_human_gate before insert or update on public.shadow_conversation_actions
  for each row execute function public.guard_manual_shadow_action();
revoke all on function public.guard_manual_shadow_action() from public,anon,authenticated;
commit;
