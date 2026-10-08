begin;

-- Intentionally EMPTY. A separately reviewed binding to the real Admin WABA /
-- phone_number_id is required before activation. The application cannot change
-- this binding. 544519 is scope metadata only, NOT an identity bridge to Respond.
create table public.meta_observer_admin_scope (
  singleton boolean primary key default true check (singleton),
  respond_channel_id text not null default '544519' check (respond_channel_id = '544519'),
  waba_id text not null check (waba_id ~ '^[0-9]{5,32}$'),
  phone_number_id text not null check (phone_number_id ~ '^[0-9]{5,32}$'),
  enabled boolean not null default false,
  unique (waba_id, phone_number_id)
);

-- Append-only observations, not work. No trigger, FK to business tables,
-- consumer, contact ID, body text, phone, media URL or auth material.
create table public.meta_observer_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'meta' check (provider = 'meta'),
  waba_id text not null,
  phone_number_id text not null,
  event_key text not null,
  native_message_id text not null check (length(native_message_id) between 7 and 506 and native_message_id ~ '^wamid\.[A-Za-z0-9+/=_-]+$'),
  event_type text not null,
  category text not null check (category in ('inbound', 'status', 'app_echo')),
  source_field text not null check (source_field in ('messages', 'smb_message_echoes')),
  occurred_at timestamptz not null check (occurred_at >= '2000-01-01'::timestamptz and occurred_at < '10000-01-01'::timestamptz),
  received_at timestamptz not null default clock_timestamp(),
  message_type text,
  status text,
  original_message_id text check (length(original_message_id) between 7 and 506 and original_message_id ~ '^wamid\.[A-Za-z0-9+/=_-]+$'),
  error_codes integer[] not null default '{}' check (cardinality(error_codes) <= 20 and 0 <= all(error_codes)),
  author_evidence text not null,
  body_sha256 text not null check (body_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'observed' check (state = 'observed'),
  observer_only boolean not null default true check (observer_only),
  foreign key (waba_id, phone_number_id) references public.meta_observer_admin_scope(waba_id, phone_number_id),
  unique (waba_id, phone_number_id, event_key),
  check (event_key = event_type || ':' || native_message_id),
  check (
    (category = 'status' and source_field = 'messages' and status is not null
      and status in ('sent', 'delivered', 'read', 'failed') and event_type = 'message.' || status
      and message_type is null and original_message_id is null and author_evidence = 'human_authorship_unproven')
    or
    (category in ('inbound', 'app_echo') and status is null and message_type is not null
      and message_type in ('text','image','audio','video','document','sticker','location','contacts',
        'interactive','button','reaction','order','system','unsupported','edit','revoke')
      and ((category = 'inbound' and source_field = 'messages' and author_evidence = 'human_authorship_unproven')
        or (category = 'app_echo' and source_field = 'smb_message_echoes' and author_evidence = 'smb_message_echoes_app_origin'))
      and ((message_type in ('edit', 'revoke') and original_message_id is not null and event_type = 'message.' || message_type)
        or (message_type not in ('edit', 'revoke') and original_message_id is null
          and event_type = case when category = 'inbound' then 'message.received' else 'message.sent' end)))
  )
);
create index meta_observer_events_received_idx on public.meta_observer_events(received_at, id);

alter table public.meta_observer_admin_scope enable row level security;
alter table public.meta_observer_events enable row level security;
-- Explicit revokes neutralize inherited project defaults for ONLY these objects.
revoke all on table public.meta_observer_admin_scope, public.meta_observer_events from public, anon, authenticated, service_role;
grant select on table public.meta_observer_admin_scope to service_role;
grant select, insert on table public.meta_observer_events to service_role;
create policy meta_observer_scope_service_read on public.meta_observer_admin_scope for select to service_role using (true);
create policy meta_observer_events_service_read on public.meta_observer_events for select to service_role using (true);
create policy meta_observer_events_service_insert on public.meta_observer_events for insert to service_role
  with check (exists (select 1 from public.meta_observer_admin_scope s
    where s.enabled and s.waba_id = meta_observer_events.waba_id and s.phone_number_id = meta_observer_events.phone_number_id));

create function public.observe_meta_admin_events_v1(p_waba_id text, p_phone_number_id text,
  p_body_sha256 text, p_events jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  e jsonb;
  inserted_count integer := 0;
  written integer;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'meta_observer_batch_invalid' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 100 or p_body_sha256 is null or p_body_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'meta_observer_batch_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.meta_observer_admin_scope
    where enabled and waba_id = p_waba_id and phone_number_id = p_phone_number_id and respond_channel_id = '544519') then
    raise exception 'meta_observer_scope_denied' using errcode = '42501';
  end if;
  -- Stable lock acquisition order for concurrent overlapping batches.
  for e in select value from jsonb_array_elements(p_events) order by value->>'event_key' loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'error_codes') is distinct from 'array' then
      raise exception 'meta_observer_event_invalid' using errcode = '22023';
    end if;
    insert into public.meta_observer_events (waba_id, phone_number_id, event_key, native_message_id,
      event_type, category, source_field, occurred_at, message_type, status, original_message_id,
      error_codes, author_evidence, body_sha256)
    values (p_waba_id, p_phone_number_id, e->>'event_key', e->>'native_message_id',
      e->>'event_type', e->>'category', e->>'source_field', (e->>'occurred_at')::timestamptz,
      e->>'message_type', e->>'status', e->>'original_message_id',
      array(select value::integer from jsonb_array_elements_text(e->'error_codes')),
      e->>'author_evidence', p_body_sha256)
    on conflict (waba_id, phone_number_id, event_key) do nothing;
    get diagnostics written = row_count;
    inserted_count := inserted_count + written;
  end loop;
  return jsonb_build_object('durable', true, 'state', 'observed', 'inserted', inserted_count,
    'duplicates', jsonb_array_length(p_events) - inserted_count);
end;
$$;
revoke all on function public.observe_meta_admin_events_v1(text, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.observe_meta_admin_events_v1(text, text, text, jsonb) to service_role;

comment on table public.meta_observer_events is 'Admin Meta receive-only audit. No commercial processing or identity linkage. Retain on code rollback.';
commit;
