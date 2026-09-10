do $$
declare
  action_domain_definition text;
  replay_domain_definition text;
  follow_up_definition text;
begin
  select pg_get_constraintdef(oid) into action_domain_definition
  from pg_constraint
  where conrelid = 'public.shadow_conversation_actions'::regclass
    and conname = 'shadow_conversation_actions_case_domain_check';
  if action_domain_definition is null or position('property_handover' in action_domain_definition) = 0 then
    raise exception 'property_handover missing from shadow_conversation_actions';
  end if;

  select pg_get_constraintdef(oid) into replay_domain_definition
  from pg_constraint
  where conrelid = 'public.shadow_historical_replay_cases'::regclass
    and conname = 'shadow_historical_replay_cases_case_domain_check';
  if replay_domain_definition is null or position('property_handover' in replay_domain_definition) = 0 then
    raise exception 'property_handover missing from historical replay';
  end if;

  select pg_get_constraintdef(oid) into follow_up_definition
  from pg_constraint
  where conrelid = 'public.shadow_conversation_actions'::regclass
    and conname = 'shadow_conversation_actions_operational_follow_up_check';
  if follow_up_definition is null
     or position('sensitive_internal_handoff' in follow_up_definition) = 0
     or position('pending_human_review' in follow_up_definition) = 0
     or position('executable' in follow_up_definition) = 0 then
    raise exception 'sensitive internal handoff constraint missing';
  end if;
end $$;
