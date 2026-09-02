-- Canary productivo Administradora IA 1/1. Infraestructura fail-closed; sin seeds ni activación.
begin;

create table if not exists public.shadow_admin_outbound_canaries (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null default '544519' check (channel_id = '544519'),
  not_before timestamptz not null,
  status text not null default 'open' check (status in ('open','closed','disabled')),
  max_claims smallint not null default 1 check (max_claims = 1),
  claimed_count smallint not null default 0 check (claimed_count between 0 and 1),
  allowed_action text not null default 'acknowledge_received_information'
    check (allowed_action = 'acknowledge_received_information'),
  claimed_conversation_id uuid null references public.shadow_conversations(id) on delete restrict,
  claimed_action_id uuid null references public.shadow_conversation_actions(id) on delete restrict,
  claimed_outbound_id uuid null,
  claimed_at timestamptz null,
  closed_at timestamptz null,
  close_reason text null check (close_reason is null or close_reason in (
    'first_claim_consumed','manual_kill_switch','preflight_abort'
  )),
  sender_result_status text null check (sender_result_status is null or sender_result_status in (
    'processing','sent','failed','delivery_unknown','blocked','superseded'
  )),
  provider_message_id text null check (provider_message_id is null or length(provider_message_id) between 1 and 120),
  result_recorded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'open' and claimed_count = 0 and claimed_conversation_id is null and claimed_action_id is null
      and claimed_outbound_id is null and claimed_at is null and closed_at is null and close_reason is null)
    or
    (status = 'closed' and claimed_count = 1 and claimed_conversation_id is not null and claimed_action_id is not null
      and claimed_outbound_id is not null and claimed_at is not null and closed_at is not null
      and close_reason = 'first_claim_consumed')
    or
    (status = 'disabled' and claimed_count = 0 and claimed_conversation_id is null and claimed_action_id is null
      and claimed_outbound_id is null and claimed_at is null and closed_at is not null
      and close_reason in ('manual_kill_switch','preflight_abort'))
  ),
  check ((provider_message_id is null) or sender_result_status = 'sent')
);

create unique index if not exists shadow_admin_outbound_canaries_single_open_uidx
  on public.shadow_admin_outbound_canaries ((1)) where status = 'open';
create unique index if not exists shadow_admin_outbound_canaries_claimed_action_uidx
  on public.shadow_admin_outbound_canaries (claimed_action_id) where claimed_action_id is not null;
create unique index if not exists shadow_admin_outbound_canaries_claimed_outbound_uidx
  on public.shadow_admin_outbound_canaries (claimed_outbound_id) where claimed_outbound_id is not null;

alter table public.shadow_admin_outbound_canaries enable row level security;
revoke all on public.shadow_admin_outbound_canaries from public,anon,authenticated,service_role;
grant select on public.shadow_admin_outbound_canaries to service_role;

alter table public.shadow_admin_outbound_messages
  add column if not exists canary_id uuid null references public.shadow_admin_outbound_canaries(id) on delete restrict;
create unique index if not exists shadow_admin_outbound_messages_canary_uidx
  on public.shadow_admin_outbound_messages(canary_id) where canary_id is not null;

alter table public.shadow_admin_outbound_canaries
  add constraint shadow_admin_outbound_canaries_claimed_outbound_fk
  foreign key (claimed_outbound_id) references public.shadow_admin_outbound_messages(id)
  on delete restrict deferrable initially deferred;

create or replace function public.arm_shadow_admin_outbound_canary(p_not_before timestamptz)
returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if p_not_before is null or p_not_before < now() - interval '1 minute' then
    raise exception 'invalid_canary_not_before';
  end if;
  insert into public.shadow_admin_outbound_canaries(not_before)
  values(p_not_before)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'canary_already_open';
end $$;

create or replace function public.disable_shadow_admin_outbound_canary(
  p_canary_id uuid,
  p_reason text default 'manual_kill_switch'
)
returns table(canary_id uuid, canary_status text)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_canary_id is null then raise exception 'invalid_canary_id'; end if;
  if p_reason not in ('manual_kill_switch','preflight_abort') then raise exception 'invalid_canary_close_reason'; end if;
  update public.shadow_admin_outbound_canaries
  set status='disabled',closed_at=now(),close_reason=p_reason,updated_at=now()
  where id=p_canary_id and status='open' and claimed_count=0;
  return query select c.id,c.status from public.shadow_admin_outbound_canaries c where c.id=p_canary_id;
end $$;

create or replace function public.claim_shadow_admin_outbound_canary(
  p_worker_id text,
  p_canary_id uuid,
  p_not_before timestamptz
)
returns table(
  canary_id uuid, outbound_id uuid, action_id uuid, message_id uuid, conversation_id uuid, turn_key text,
  channel_id text, respond_contact_id text, conversation_action text, case_domain text,
  interaction_direction text, proposed_message text, confidence numeric,
  requires_human boolean, auto_send_eligible boolean, expires_at timestamptz,
  anchor_occurred_at timestamptz, action_created_at timestamptz, canary_content_eligible boolean
)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_canary public.shadow_admin_outbound_canaries%rowtype;
  v_action public.shadow_conversation_actions%rowtype;
  v_outbound_id uuid := gen_random_uuid();
begin
  if coalesce(length(trim(p_worker_id)),0) < 8 or length(p_worker_id)>120 then raise exception 'invalid_worker_id'; end if;
  if p_canary_id is null then raise exception 'invalid_canary_id'; end if;
  if p_not_before is null then raise exception 'invalid_not_before'; end if;

  select * into v_canary
  from public.shadow_admin_outbound_canaries
  where id=p_canary_id
  for update;

  if v_canary.id is null then raise exception 'canary_not_found'; end if;
  if v_canary.status <> 'open' or v_canary.claimed_count <> 0 then return; end if;
  if v_canary.max_claims <> 1 or v_canary.allowed_action <> 'acknowledge_received_information' then
    raise exception 'invalid_canary_policy';
  end if;
  if v_canary.not_before <> p_not_before then raise exception 'canary_cutoff_mismatch'; end if;

  select a.* into v_action
  from public.shadow_conversation_actions a
  join public.shadow_messages anchor on anchor.id=a.message_id and anchor.direction='inbound'
  join public.shadow_conversations c on c.id=a.conversation_id
    and c.provider='respond_admin' and c.channel='544519' and c.respond_contact_id is not null
  where a.status='proposed'
    and a.auto_send_eligible=true
    and a.requires_human=false
    and a.confidence>=0.75
    and a.expires_at>now()
    and a.created_at>=v_canary.not_before
    and anchor.occurred_at>=v_canary.not_before
    and a.interaction_direction='inbound_customer_action'
    and a.conversation_action='acknowledge_received_information'
    and a.case_domain='administrative_pending'
    and jsonb_array_length(a.evidence_refs)>0
    and a.proposed_message='Gracias, recibí la información que compartiste.'
    and anchor.sanitized_text ~* '(paso|mando|env[ií]o|comparto|dejo).{0,80}(correo|email)'
    and anchor.sanitized_text !~* '(pago|pagad|saldo|monto|periodo|renta|adeudo|contrato|comisi[oó]n|reembolso|devoluci[oó]n|autoriza|responsab|jur[ií]d|legal|dep[oó]sito|transfer|banco|factura|recibo|comprobante|servicio|luz|agua|gas|manten|fuga|repar|propietar|inquilin|tel[eé]fono|domicilio|direcci[oó]n|rfc|curp|clabe|cuenta|tarjeta|identificaci[oó]n|pasaporte)'
    and exists(
      select 1 from public.respond_identity_links ril
      join public.client_identities ci on ci.id=ril.client_identity_id and ci.status='active'
      where ril.respond_contact_id=c.respond_contact_id and ril.link_status='confirmed'
    )
    and not exists(
      select 1 from public.shadow_messages newer
      where newer.conversation_id=a.conversation_id and newer.occurred_at>anchor.occurred_at
    )
  order by a.created_at asc
  for update of a skip locked
  limit 1;

  if v_action.id is null then return; end if;

  update public.shadow_conversation_actions
  set status='approved_for_future_auto',updated_at=now()
  where id=v_action.id and status='proposed';
  if not found then return; end if;

  update public.shadow_admin_outbound_canaries
  set status='closed',claimed_count=1,claimed_conversation_id=v_action.conversation_id,
    claimed_action_id=v_action.id,claimed_outbound_id=v_outbound_id,claimed_at=now(),closed_at=now(),
    close_reason='first_claim_consumed',updated_at=now()
  where id=v_canary.id and status='open' and claimed_count=0;
  if not found then raise exception 'canary_claim_race_lost'; end if;

  insert into public.shadow_admin_outbound_messages(
    id,canary_id,conversation_action_id,conversation_id,message_id,turn_key,channel_id,
    conversation_action,case_domain,status,worker_id
  ) values(
    v_outbound_id,v_canary.id,v_action.id,v_action.conversation_id,v_action.message_id,v_action.turn_key,'544519',
    v_action.conversation_action,v_action.case_domain,'processing',p_worker_id
  );

  select v_canary.id,v_outbound_id,v_action.id,v_action.message_id,v_action.conversation_id,v_action.turn_key,
    c.channel,c.respond_contact_id,v_action.conversation_action,v_action.case_domain,v_action.interaction_direction,
    v_action.proposed_message,v_action.confidence,v_action.requires_human,v_action.auto_send_eligible,
    v_action.expires_at,anchor.occurred_at,v_action.created_at,true
  into canary_id,outbound_id,action_id,message_id,conversation_id,turn_key,channel_id,respond_contact_id,
    conversation_action,case_domain,interaction_direction,proposed_message,confidence,requires_human,
    auto_send_eligible,expires_at,anchor_occurred_at,action_created_at,canary_content_eligible
  from public.shadow_conversations c
  join public.shadow_messages anchor on anchor.id=v_action.message_id
  where c.id=v_action.conversation_id;
  return next;
end $$;

create or replace function public.sync_shadow_admin_outbound_canary_result()
returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.canary_id is null then return new; end if;
  update public.shadow_admin_outbound_canaries
  set sender_result_status=new.status,
    provider_message_id=case when new.status='sent' then new.provider_message_id else null end,
    result_recorded_at=now(),updated_at=now()
  where id=new.canary_id and claimed_outbound_id=new.id and status='closed';
  return new;
end $$;

drop trigger if exists sync_shadow_admin_outbound_canary_result on public.shadow_admin_outbound_messages;
create trigger sync_shadow_admin_outbound_canary_result
after insert or update of status,provider_message_id on public.shadow_admin_outbound_messages
for each row execute function public.sync_shadow_admin_outbound_canary_result();

revoke all on function public.arm_shadow_admin_outbound_canary(timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.disable_shadow_admin_outbound_canary(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.claim_shadow_admin_outbound_canary(text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.sync_shadow_admin_outbound_canary_result() from public,anon,authenticated,service_role;
grant execute on function public.arm_shadow_admin_outbound_canary(timestamptz) to service_role;
grant execute on function public.disable_shadow_admin_outbound_canary(uuid,text) to service_role;
grant execute on function public.claim_shadow_admin_outbound_canary(text,uuid,timestamptz) to service_role;

comment on table public.shadow_admin_outbound_canaries is 'Gate durable 1/1 sin PII para el primer canary Admin; se consume atómicamente al claim.';
comment on function public.claim_shadow_admin_outbound_canary(text,uuid,timestamptz) is 'Claim canary 1/1: sólo acknowledgement neutral no financiero posterior al cutoff de action e inbound.';
comment on function public.disable_shadow_admin_outbound_canary(uuid,text) is 'Kill switch durable: impide claims nuevos sin esperar redeploy.';

commit;
