-- Fase 3B outbound Admin supervisado. Infraestructura fail-closed; sin seeds ni activación.
begin;

create table if not exists public.shadow_admin_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_action_id uuid not null references public.shadow_conversation_actions(id) on delete restrict,
  conversation_id uuid not null references public.shadow_conversations(id) on delete restrict,
  message_id uuid not null references public.shadow_messages(id) on delete restrict,
  turn_key text not null check (length(turn_key) between 8 and 160 and turn_key !~ '[[:space:]]'),
  channel_id text not null check (channel_id = '544519'),
  conversation_action text not null check (conversation_action in (
    'ask_missing_information','clarify_property','clarify_payment_amount','clarify_payment_period',
    'request_document','acknowledge_received_information','provide_verified_status'
  )),
  case_domain text not null check (case_domain in ('maintenance','payment','administrative_pending')),
  status text not null check (status in ('processing','sent','failed','delivery_unknown','blocked','superseded')),
  provider_message_id text null check (provider_message_id is null or length(provider_message_id) between 1 and 120),
  worker_id text not null check (length(worker_id) between 8 and 120),
  error_code text null check (error_code is null or error_code ~ '^[a-z0-9_]{3,80}$'),
  claimed_at timestamptz not null default now(),
  sent_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_action_id),
  unique (turn_key),
  check ((status='sent') = (provider_message_id is not null and sent_at is not null)),
  check (status='processing' or completed_at is not null)
);

create index if not exists shadow_admin_outbound_status_created_idx on public.shadow_admin_outbound_messages(status,created_at desc);
alter table public.shadow_admin_outbound_messages enable row level security;
revoke all on public.shadow_admin_outbound_messages from public,anon,authenticated,service_role;
grant select,insert,update on public.shadow_admin_outbound_messages to service_role;

drop function if exists public.claim_shadow_admin_outbound(text);
create or replace function public.claim_shadow_admin_outbound(p_worker_id text, p_not_before timestamptz)
returns table(
  outbound_id uuid, action_id uuid, message_id uuid, conversation_id uuid, turn_key text,
  channel_id text, respond_contact_id text, conversation_action text, case_domain text,
  interaction_direction text, proposed_message text, confidence numeric,
  requires_human boolean, auto_send_eligible boolean, expires_at timestamptz,
  anchor_occurred_at timestamptz, action_created_at timestamptz
)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_action public.shadow_conversation_actions%rowtype;
begin
  if coalesce(length(trim(p_worker_id)),0) < 8 or length(p_worker_id)>120 then raise exception 'invalid_worker_id'; end if;
  if p_not_before is null then raise exception 'invalid_not_before'; end if;
  perform pg_advisory_xact_lock(hashtext('shadow_admin_outbound_supervised_v1'));
  if (select count(*) from public.shadow_admin_outbound_messages) >= 10 then return; end if;

  select a.* into v_action
  from public.shadow_conversation_actions a
  join public.shadow_messages anchor on anchor.id=a.message_id and anchor.direction='inbound'
  join public.shadow_conversations c on c.id=a.conversation_id and c.provider='respond_admin' and c.channel='544519' and c.respond_contact_id is not null
  where a.status='proposed' and a.auto_send_eligible=true and a.requires_human=false and a.expires_at>now()
    and a.created_at>=p_not_before
    and a.interaction_direction='inbound_customer_action'
    and a.conversation_action in ('ask_missing_information','clarify_property','clarify_payment_amount','clarify_payment_period','request_document','acknowledge_received_information','provide_verified_status')
    and exists(select 1 from public.respond_identity_links ril join public.client_identities ci on ci.id=ril.client_identity_id and ci.status='active' where ril.respond_contact_id=c.respond_contact_id and ril.link_status='confirmed')
    and not exists(select 1 from public.shadow_messages newer where newer.conversation_id=a.conversation_id and newer.occurred_at>anchor.occurred_at)
  order by a.created_at asc for update of a skip locked limit 1;
  if v_action.id is null then return; end if;

  insert into public.shadow_admin_outbound_messages(conversation_action_id,conversation_id,message_id,turn_key,channel_id,conversation_action,case_domain,status,worker_id)
  values(v_action.id,v_action.conversation_id,v_action.message_id,v_action.turn_key,'544519',v_action.conversation_action,v_action.case_domain,'processing',p_worker_id)
  returning id into outbound_id;
  update public.shadow_conversation_actions set status='approved_for_future_auto',updated_at=now() where id=v_action.id and status='proposed';

  select v_action.id,v_action.message_id,v_action.conversation_id,v_action.turn_key,c.channel,c.respond_contact_id,
    v_action.conversation_action,v_action.case_domain,v_action.interaction_direction,v_action.proposed_message,v_action.confidence,
    v_action.requires_human,v_action.auto_send_eligible,v_action.expires_at,anchor.occurred_at,v_action.created_at
  into action_id,message_id,conversation_id,turn_key,channel_id,respond_contact_id,conversation_action,case_domain,
    interaction_direction,proposed_message,confidence,requires_human,auto_send_eligible,expires_at,anchor_occurred_at,action_created_at
  from public.shadow_conversations c join public.shadow_messages anchor on anchor.id=v_action.message_id where c.id=v_action.conversation_id;
  return next;
end $$;

revoke all on function public.claim_shadow_admin_outbound(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.claim_shadow_admin_outbound(text,timestamptz) to service_role;

comment on table public.shadow_admin_outbound_messages is 'Auditoría minimizada del sender Admin 544519; hard cap acumulado de 10 claims y sin payload Respond';
comment on function public.claim_shadow_admin_outbound(text,timestamptz) is 'Claim atómico posterior al cutoff explícito; no envía mensajes y falla cerrado fuera de 544519';
commit;
