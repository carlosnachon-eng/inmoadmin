-- DEV ONLY: Fase 2A P0, cerebro shadow provider-agnostic.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- Produccion bloqueada: bnzrnizrmonjxlktbhlp.
begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regprocedure('public.current_profile_role_id()') is null then
    raise exception 'P0 shadow requiere profiles y current_profile_role_id()';
  end if;
  if exists (
    select 1 from (values
      ('shadow_conversations'), ('shadow_messages'), ('shadow_ingestion_events'),
      ('shadow_context_matches'), ('shadow_human_evaluations'),
      ('shadow_context_query_audit'), ('shadow_ai_runs'), ('shadow_ai_decisions')
    ) expected(name)
    where to_regclass('public.' || expected.name) is not null
      and coalesce(obj_description(to_regclass('public.' || expected.name), 'pg_class'), '')
        <> 'dev-bootstrap:202608180005:fase-2a-p0-shadow'
  ) then raise exception 'Colision con objetos shadow preexistentes sin marcador DEV'; end if;
end $$;

create table if not exists public.shadow_conversations (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('synthetic','respond','meta','bsp')),
  external_conversation_id text not null check (length(external_conversation_id) between 1 and 200),
  contact_hash text not null check (contact_hash ~ '^[0-9a-f]{64}$'),
  channel text not null default 'unknown' check (length(channel) between 1 and 80),
  first_message_at timestamptz not null,
  last_message_at timestamptz not null,
  administrative_likelihood text not null default 'unknown' check (administrative_likelihood in ('high','medium','low','unknown')),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_conversation_id)
);
create table if not exists public.shadow_ingestion_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text,
  external_message_id text,
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('accepted','duplicate','rejected','error')),
  error_code text,
  sanitization_changed boolean not null default false,
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider, payload_fingerprint)
);
create unique index if not exists shadow_ingestion_provider_event_uidx on public.shadow_ingestion_events(provider, external_event_id) where external_event_id is not null;

create table if not exists public.shadow_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.shadow_conversations(id) on delete cascade,
  ingestion_event_id uuid references public.shadow_ingestion_events(id) on delete set null,
  provider text not null,
  external_message_id text,
  direction text not null check (direction in ('inbound','outbound')),
  occurred_at timestamptz not null,
  sanitized_text text not null check (length(sanitized_text) <= 2000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  message_type text not null default 'text' check (message_type in ('text','attachment','mixed','unknown')),
  attachment_metadata jsonb not null default '[]'::jsonb check (jsonb_typeof(attachment_metadata) = 'array'),
  provider_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_metadata) = 'object'),
  processing_state text not null default 'classified' check (processing_state in ('classified','needs_review','rejected')),
  intent text not null default 'no_determinado',
  administrative_likelihood text not null default 'unknown' check (administrative_likelihood in ('high','medium','low','unknown')),
  reason_codes text[] not null default '{}',
  requires_human boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists shadow_messages_provider_message_uidx on public.shadow_messages(provider, external_message_id) where external_message_id is not null;
create index if not exists shadow_messages_conversation_occurred_idx on public.shadow_messages(conversation_id, occurred_at desc);

create table if not exists public.shadow_context_matches (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.shadow_messages(id) on delete cascade,
  internal_entity_type text not null check (internal_entity_type in ('property','contract','payment','service','maintenance_ticket','work_center_case','key','owner_liquidation','policy','signature','condominium_fee')),
  internal_id text not null check (length(internal_id) between 1 and 200),
  display_label text check (length(display_label) <= 300),
  match_method text not null,
  confidence_rank integer not null check (confidence_rank between 0 and 100),
  ambiguous boolean not null default false,
  reason_code text not null,
  context_href text check (context_href is null or context_href ~ '^/'),
  created_at timestamptz not null default now(),
  unique(message_id, internal_entity_type, internal_id)
);

create table if not exists public.shadow_human_evaluations (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.shadow_messages(id) on delete cascade,
  classification text not null check (classification in ('correct','partially_correct','incorrect','wrong_context','wrong_intent','not_administration')),
  labels text[] not null default '{}',
  expected_correction text check (length(expected_correction) <= 1000),
  notes text check (length(notes) <= 1000),
  actor_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists shadow_evaluations_message_created_idx on public.shadow_human_evaluations(message_id, created_at desc);

create table if not exists public.shadow_context_query_audit (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.shadow_messages(id) on delete cascade,
  tool_name text not null,
  result_count integer not null default 0 check (result_count between 0 and 5),
  succeeded boolean not null,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.shadow_ai_runs (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.shadow_messages(id) on delete cascade,
  status text not null default 'not_executed' check (status = 'not_executed'),
  created_at timestamptz not null default now()
);
create table if not exists public.shadow_ai_decisions (
  id uuid primary key default gen_random_uuid(),
  ai_run_id uuid not null references public.shadow_ai_runs(id) on delete cascade,
  status text not null default 'not_executed' check (status = 'not_executed'),
  created_at timestamptz not null default now()
);

do $$ declare table_name text; begin
  foreach table_name in array array['shadow_conversations','shadow_messages','shadow_ingestion_events','shadow_context_matches','shadow_human_evaluations','shadow_context_query_audit','shadow_ai_runs','shadow_ai_decisions'] loop
    execute format('comment on table public.%I is %L', table_name, 'dev-bootstrap:202608180005:fase-2a-p0-shadow');
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end $$;

create or replace function public.shadow_authorized_role() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active=true and p.role_id in ('admin','coord_operaciones'));
$$;
revoke all on function public.shadow_authorized_role() from public, anon;
grant execute on function public.shadow_authorized_role() to authenticated, service_role;

do $$ declare table_name text; begin
  foreach table_name in array array['shadow_conversations','shadow_messages','shadow_ingestion_events','shadow_context_matches','shadow_human_evaluations','shadow_context_query_audit','shadow_ai_runs','shadow_ai_decisions'] loop
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_authorized_select', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (public.shadow_authorized_role())', table_name || '_authorized_select', table_name);
  end loop;
end $$;

grant insert on public.shadow_human_evaluations to authenticated;
drop policy if exists shadow_human_evaluations_authorized_insert on public.shadow_human_evaluations;
create policy shadow_human_evaluations_authorized_insert on public.shadow_human_evaluations
for insert to authenticated with check (public.shadow_authorized_role() and actor_profile_id=auth.uid());

create or replace function public.ingest_shadow_message(p_envelope jsonb, p_classification jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_event uuid; v_conversation uuid; v_message uuid; v_existing uuid;
begin
  if coalesce(p_envelope->>'provider','') not in ('synthetic','respond') then raise exception 'Provider P0 no permitido'; end if;
  select id into v_existing from public.shadow_messages where provider=p_envelope->>'provider' and external_message_id=p_envelope->>'externalMessageId';
  if v_existing is not null then
    update public.shadow_ingestion_events set duplicate_count=duplicate_count+1
      where provider=p_envelope->>'provider' and (external_message_id=p_envelope->>'externalMessageId' or payload_fingerprint=p_envelope->>'payloadFingerprint');
    return jsonb_build_object('status','duplicate','messageId',v_existing);
  end if;
  insert into public.shadow_ingestion_events(provider,external_event_id,external_message_id,payload_fingerprint,status,sanitization_changed,processed_at)
  values(p_envelope->>'provider',p_envelope->>'externalEventId',p_envelope->>'externalMessageId',p_envelope->>'payloadFingerprint',case when (p_envelope->>'sanitizationRejected')::boolean then 'rejected' else 'accepted' end,coalesce((p_envelope->>'sanitizationChanged')::boolean,false),now())
  on conflict(provider,payload_fingerprint) do update set duplicate_count=shadow_ingestion_events.duplicate_count+1 returning id into v_event;
  if (p_envelope->>'sanitizationRejected')::boolean then return jsonb_build_object('status','rejected','eventId',v_event); end if;
  insert into public.shadow_conversations(provider,external_conversation_id,contact_hash,channel,first_message_at,last_message_at,administrative_likelihood)
  values(p_envelope->>'provider',p_envelope->>'externalConversationId',p_envelope->>'externalContactHash',p_envelope->>'channel',(p_envelope->>'occurredAt')::timestamptz,(p_envelope->>'occurredAt')::timestamptz,p_classification->>'administrativeLikelihood')
  on conflict(provider,external_conversation_id) do update set first_message_at=least(shadow_conversations.first_message_at,excluded.first_message_at),last_message_at=greatest(shadow_conversations.last_message_at,excluded.last_message_at),administrative_likelihood=excluded.administrative_likelihood,updated_at=now()
  returning id into v_conversation;
  insert into public.shadow_messages(conversation_id,ingestion_event_id,provider,external_message_id,direction,occurred_at,sanitized_text,content_hash,message_type,attachment_metadata,provider_metadata,processing_state,intent,administrative_likelihood,reason_codes,requires_human)
  values(v_conversation,v_event,p_envelope->>'provider',p_envelope->>'externalMessageId',p_envelope->>'direction',(p_envelope->>'occurredAt')::timestamptz,p_envelope->>'sanitizedText',encode(extensions.digest(p_envelope->>'sanitizedText','sha256'),'hex'),case when jsonb_array_length(p_envelope->'attachmentMetadata')>0 and coalesce(p_envelope->>'sanitizedText','')<>'' then 'mixed' when jsonb_array_length(p_envelope->'attachmentMetadata')>0 then 'attachment' else 'text' end,p_envelope->'attachmentMetadata',p_envelope->'providerMetadata',case when (p_classification->>'requiresHuman')::boolean then 'needs_review' else 'classified' end,p_classification->>'intent',p_classification->>'administrativeLikelihood',array(select jsonb_array_elements_text(p_classification->'reasonCodes')),(p_classification->>'requiresHuman')::boolean)
  returning id into v_message;
  return jsonb_build_object('status','accepted','messageId',v_message,'conversationId',v_conversation);
end $$;
revoke all on function public.ingest_shadow_message(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_shadow_message(jsonb,jsonb) to service_role;

commit;
