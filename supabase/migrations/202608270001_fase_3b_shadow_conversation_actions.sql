-- Fase 3B: propuestas conversacionales Shadow. Sin outbound ni acciones ERP/Respond.
begin;

do $$ begin
  if to_regclass('public.shadow_ai_runs') is null
     or to_regclass('public.shadow_messages') is null
     or to_regclass('public.shadow_conversations') is null then
    raise exception 'Fase 3B requiere Shadow AI, mensajes y conversaciones';
  end if;
end $$;

create table if not exists public.shadow_conversation_actions (
  id uuid primary key default gen_random_uuid(),
  ai_run_id uuid not null references public.shadow_ai_runs(id) on delete restrict,
  message_id uuid not null references public.shadow_messages(id) on delete restrict,
  conversation_id uuid not null references public.shadow_conversations(id) on delete restrict,
  turn_key text not null check (length(turn_key) between 8 and 160 and turn_key !~ '[[:space:]]'),
  case_domain text not null check (case_domain in ('maintenance','payment','administrative_pending')),
  conversation_action text not null check (conversation_action in (
    'ask_missing_information','request_document','clarify_property','clarify_payment_amount',
    'clarify_payment_period','acknowledge_received_information','provide_verified_status',
    'human_handoff','no_message'
  )),
  question_type text not null check (question_type in (
    'ask_missing_information','request_document','clarify_property','clarify_payment_amount',
    'clarify_payment_period','acknowledge_received_information','provide_verified_status',
    'human_handoff','no_message'
  )),
  status text not null default 'proposed' check (status in (
    'proposed','approved_for_future_auto','superseded','expired','rejected','sent'
  )),
  proposed_message text null check (proposed_message is null or length(proposed_message) between 1 and 480),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs)='array' and jsonb_array_length(evidence_refs)<=20),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  requires_human boolean not null default true,
  auto_send_eligible boolean not null default false,
  blocked_reason text null check (blocked_reason is null or blocked_reason ~ '^[a-z0-9_]{3,80}$'),
  superseded_by_message_id uuid null references public.shadow_messages(id) on delete restrict,
  superseded_at timestamptz null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status='superseded') = (superseded_by_message_id is not null and superseded_at is not null)),
  check (status<>'sent' or auto_send_eligible),
  check (not auto_send_eligible or (not requires_human and status in ('proposed','approved_for_future_auto','sent')))
);

create unique index if not exists shadow_conversation_actions_turn_uidx
  on public.shadow_conversation_actions(turn_key);
create unique index if not exists shadow_conversation_actions_run_uidx
  on public.shadow_conversation_actions(ai_run_id);
create index if not exists shadow_conversation_actions_status_created_idx
  on public.shadow_conversation_actions(status, created_at desc);
create index if not exists shadow_conversation_actions_conversation_idx
  on public.shadow_conversation_actions(conversation_id, created_at desc);

alter table public.shadow_conversation_actions enable row level security;
revoke all on public.shadow_conversation_actions from public, anon, authenticated, service_role;
grant select, insert, update on public.shadow_conversation_actions to service_role;

comment on table public.shadow_conversation_actions is 'Fase 3B: propuestas sanitizadas no enviadas; no contiene payload Respond, teléfono, email ni binarios';
comment on column public.shadow_conversation_actions.status is 'sent queda reservado; Fase 3B inicial no implementa ningún sender';

commit;
