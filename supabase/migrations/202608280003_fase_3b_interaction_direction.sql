-- Fase 3B: actor/dirección determinística y seguimiento interno no ejecutable.
begin;

alter table public.shadow_conversation_actions
  add column if not exists interaction_direction text not null default 'ambiguous_actor'
    check (interaction_direction in (
      'inbound_customer_action','internal_instruction_about_customer',
      'verified_status_update','ambiguous_actor'
    )),
  add column if not exists operational_follow_up jsonb null
    check (operational_follow_up is null or (
      jsonb_typeof(operational_follow_up) = 'object'
      and operational_follow_up->>'type' = 'third_party_administrative_follow_up'
      and operational_follow_up->>'status' = 'pending_human_authorization'
      and operational_follow_up->>'executable' = 'false'
    ));

alter table public.shadow_conversation_actions
  drop constraint if exists shadow_conversation_actions_internal_instruction_guard;
alter table public.shadow_conversation_actions
  add constraint shadow_conversation_actions_internal_instruction_guard check (
    interaction_direction <> 'internal_instruction_about_customer'
    or (
      conversation_action = 'no_message'
      and auto_send_eligible = false
      and proposed_message is null
      and operational_follow_up is not null
    )
  );

revoke all on public.shadow_conversation_actions from public, anon, authenticated, service_role;
grant select, insert, update on public.shadow_conversation_actions to service_role;

comment on column public.shadow_conversation_actions.interaction_direction is
  'Dirección determinística server-side; un nombre mencionado no determina al autor';
comment on column public.shadow_conversation_actions.operational_follow_up is
  'Seguimiento sanitizado no ejecutable; nunca contiene destinatario, teléfono ni payload Respond';

commit;
