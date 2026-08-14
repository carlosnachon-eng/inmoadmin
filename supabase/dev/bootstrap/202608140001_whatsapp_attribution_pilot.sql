-- DEV ONLY. Never run this file as a Production migration.
-- Web -> WhatsApp -> Respond.io attribution pilot for project hjfwjnejbcpmknvfpdcq.

begin;

create table public.whatsapp_attributions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  reference_code text not null unique check (
    reference_code ~ '^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$'
  ),
  status text not null default 'clicked' check (
    status in ('clicked', 'message_observed', 'contact_linked', 'expired', 'invalid')
  ),
  page_origin text not null default 'emporio_web_preview' check (
    page_origin = 'emporio_web_preview'
  ),
  page_path text not null check (
    char_length(page_path) between 1 and 240
    and left(page_path, 1) = '/'
    and position('?' in page_path) = 0
    and position('#' in page_path) = 0
  ),
  property_id uuid,
  property_public_id text not null check (char_length(property_public_id) between 1 and 128),
  property_slug text check (property_slug is null or char_length(property_slug) <= 180),
  service text not null check (service in ('property_sale', 'property_lease', 'property_interest')),
  cta text not null check (cta = 'property_contact_card_whatsapp'),
  first_touch jsonb not null check (jsonb_typeof(first_touch) = 'object'),
  last_touch jsonb not null check (jsonb_typeof(last_touch) = 'object'),
  source text not null check (char_length(source) between 1 and 100),
  medium text not null check (char_length(medium) between 1 and 100),
  campaign text check (campaign is null or char_length(campaign) <= 100),
  content text check (content is null or char_length(content) <= 100),
  term text check (term is null or char_length(term) <= 100),
  respond_contact_id text check (
    respond_contact_id is null or char_length(respond_contact_id) between 1 and 128
  ),
  linked_webhook_event_id text unique,
  linked_message_id text,
  clicked_at timestamptz not null default now(),
  message_observed_at timestamptz,
  contact_linked_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  retention_expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > clicked_at),
  check (retention_expires_at >= expires_at),
  check (
    status <> 'contact_linked'
    or (
      respond_contact_id is not null
      and message_observed_at is not null
      and contact_linked_at is not null
    )
  )
);

create table public.whatsapp_attribution_events (
  id bigint generated always as identity primary key,
  attribution_id uuid not null references public.whatsapp_attributions(id),
  event_type text not null check (
    event_type in ('clicked', 'message_observed', 'contact_linked', 'expired', 'invalid', 'replayed')
  ),
  webhook_event_id text,
  respond_contact_id text,
  message_id text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create unique index whatsapp_attribution_events_webhook_type_uidx
  on public.whatsapp_attribution_events (webhook_event_id, event_type)
  where webhook_event_id is not null;

create index whatsapp_attributions_status_expires_idx
  on public.whatsapp_attributions (status, expires_at, clicked_at);

create index whatsapp_attributions_contact_idx
  on public.whatsapp_attributions (respond_contact_id, contact_linked_at desc)
  where respond_contact_id is not null;

create index whatsapp_attributions_property_idx
  on public.whatsapp_attributions (property_public_id, clicked_at desc);

create index whatsapp_attribution_events_attribution_idx
  on public.whatsapp_attribution_events (attribution_id, occurred_at, id);

alter table public.whatsapp_attributions enable row level security;
alter table public.whatsapp_attribution_events enable row level security;

revoke all on table public.whatsapp_attributions from public, anon, authenticated;
revoke all on table public.whatsapp_attribution_events from public, anon, authenticated;
revoke all on sequence public.whatsapp_attribution_events_id_seq from public, anon, authenticated;

grant select, insert, update, delete on table public.whatsapp_attributions to service_role;
grant select, insert, update, delete on table public.whatsapp_attribution_events to service_role;
grant usage, select on sequence public.whatsapp_attribution_events_id_seq to service_role;

create or replace function public.create_whatsapp_attribution_click(
  p_request_id uuid,
  p_reference_code text,
  p_page_path text,
  p_property_id uuid,
  p_property_public_id text,
  p_property_slug text,
  p_service text,
  p_cta text,
  p_first_touch jsonb,
  p_last_touch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.whatsapp_attributions%rowtype;
  v_row public.whatsapp_attributions%rowtype;
  v_reference text := upper(trim(coalesce(p_reference_code, '')));
  v_source text;
  v_medium text;
  v_campaign text;
  v_content text;
  v_term text;
begin
  if p_request_id is null then
    raise exception 'request_id_required' using errcode = '22023';
  end if;

  select * into v_existing
  from public.whatsapp_attributions
  where request_id = p_request_id;

  if found then
    return jsonb_build_object(
      'status', 'deduplicated',
      'attribution_id', v_existing.id,
      'reference_code', v_existing.reference_code,
      'expires_at', v_existing.expires_at
    );
  end if;

  if v_reference !~ '^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$' then
    raise exception 'invalid_reference_code' using errcode = '22023';
  end if;
  if p_page_path is null
     or char_length(p_page_path) not between 1 and 240
     or left(p_page_path, 1) <> '/'
     or position('?' in p_page_path) > 0
     or position('#' in p_page_path) > 0 then
    raise exception 'invalid_page_path' using errcode = '22023';
  end if;
  if p_property_public_id is null or char_length(trim(p_property_public_id)) not between 1 and 128 then
    raise exception 'property_public_id_required' using errcode = '22023';
  end if;
  if p_service not in ('property_sale', 'property_lease', 'property_interest')
     or p_cta <> 'property_contact_card_whatsapp' then
    raise exception 'invalid_property_context' using errcode = '22023';
  end if;
  if jsonb_typeof(p_first_touch) <> 'object' or jsonb_typeof(p_last_touch) <> 'object' then
    raise exception 'touch_context_required' using errcode = '22023';
  end if;

  v_source := left(coalesce(nullif(trim(p_last_touch ->> 'source'), ''), 'direct'), 100);
  v_medium := left(coalesce(nullif(trim(p_last_touch ->> 'medium'), ''), '(none)'), 100);
  v_campaign := nullif(left(trim(coalesce(p_last_touch ->> 'campaign', '')), 100), '');
  v_content := nullif(left(trim(coalesce(p_last_touch ->> 'content', '')), 100), '');
  v_term := nullif(left(trim(coalesce(p_last_touch ->> 'term', '')), 100), '');

  if (
    select count(*)
    from public.whatsapp_attributions
    where clicked_at >= now() - interval '1 minute'
  ) >= 30 then
    raise exception 'attribution_rate_limited' using errcode = 'P0001';
  end if;

  insert into public.whatsapp_attributions (
    request_id,
    reference_code,
    page_path,
    property_id,
    property_public_id,
    property_slug,
    service,
    cta,
    first_touch,
    last_touch,
    source,
    medium,
    campaign,
    content,
    term
  ) values (
    p_request_id,
    v_reference,
    p_page_path,
    p_property_id,
    trim(p_property_public_id),
    nullif(left(trim(coalesce(p_property_slug, '')), 180), ''),
    p_service,
    p_cta,
    p_first_touch,
    p_last_touch,
    v_source,
    v_medium,
    v_campaign,
    v_content,
    v_term
  ) returning * into v_row;

  insert into public.whatsapp_attribution_events (
    attribution_id,
    event_type,
    occurred_at,
    metadata
  ) values (
    v_row.id,
    'clicked',
    v_row.clicked_at,
    jsonb_build_object('source', v_row.source, 'medium', v_row.medium)
  );

  return jsonb_build_object(
    'status', 'created',
    'attribution_id', v_row.id,
    'reference_code', v_row.reference_code,
    'expires_at', v_row.expires_at
  );
end
$$;

create or replace function public.observe_whatsapp_attribution_message(
  p_reference_code text,
  p_webhook_event_id text,
  p_respond_contact_id text,
  p_message_id text,
  p_event_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reference text := upper(trim(coalesce(p_reference_code, '')));
  v_row public.whatsapp_attributions%rowtype;
  v_occurred_at timestamptz := coalesce(p_event_occurred_at, now());
  v_duplicate boolean;
begin
  if v_reference !~ '^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$'
     or nullif(trim(coalesce(p_webhook_event_id, '')), '') is null
     or nullif(trim(coalesce(p_respond_contact_id, '')), '') is null then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  select exists (
    select 1
    from public.whatsapp_attribution_events
    where webhook_event_id = p_webhook_event_id
  ) into v_duplicate;

  if v_duplicate then
    return jsonb_build_object('status', 'duplicate_event');
  end if;

  select * into v_row
  from public.whatsapp_attributions
  where reference_code = v_reference
  for update;

  if not found then
    return jsonb_build_object('status', 'invalid_reference');
  end if;

  if v_row.expires_at <= now() then
    update public.whatsapp_attributions
    set status = 'expired', updated_at = now()
    where id = v_row.id and status <> 'contact_linked';

    insert into public.whatsapp_attribution_events (
      attribution_id, event_type, webhook_event_id, respond_contact_id,
      message_id, occurred_at, metadata
    ) values (
      v_row.id, 'expired', p_webhook_event_id, left(p_respond_contact_id, 128),
      nullif(left(coalesce(p_message_id, ''), 128), ''), v_occurred_at,
      jsonb_build_object('outcome', 'expired_reference')
    );
    return jsonb_build_object('status', 'expired', 'attribution_id', v_row.id);
  end if;

  if v_row.status = 'contact_linked' then
    insert into public.whatsapp_attribution_events (
      attribution_id, event_type, webhook_event_id, respond_contact_id,
      message_id, occurred_at, metadata
    ) values (
      v_row.id, 'replayed', p_webhook_event_id, left(p_respond_contact_id, 128),
      nullif(left(coalesce(p_message_id, ''), 128), ''), v_occurred_at,
      jsonb_build_object(
        'outcome', case
          when v_row.respond_contact_id = p_respond_contact_id then 'same_contact_replay'
          else 'different_contact_rejected'
        end
      )
    );
    return jsonb_build_object(
      'status', case
        when v_row.respond_contact_id = p_respond_contact_id then 'replay_same_contact'
        else 'replay_rejected'
      end,
      'attribution_id', v_row.id
    );
  end if;

  update public.whatsapp_attributions
  set status = 'message_observed',
      message_observed_at = v_occurred_at,
      updated_at = now()
  where id = v_row.id;

  insert into public.whatsapp_attribution_events (
    attribution_id, event_type, webhook_event_id, respond_contact_id,
    message_id, occurred_at, metadata
  ) values (
    v_row.id, 'message_observed', p_webhook_event_id, left(p_respond_contact_id, 128),
    nullif(left(coalesce(p_message_id, ''), 128), ''), v_occurred_at,
    '{}'::jsonb
  );

  update public.whatsapp_attributions
  set status = 'contact_linked',
      respond_contact_id = left(p_respond_contact_id, 128),
      linked_webhook_event_id = p_webhook_event_id,
      linked_message_id = nullif(left(coalesce(p_message_id, ''), 128), ''),
      contact_linked_at = v_occurred_at,
      updated_at = now()
  where id = v_row.id;

  insert into public.whatsapp_attribution_events (
    attribution_id, event_type, webhook_event_id, respond_contact_id,
    message_id, occurred_at, metadata
  ) values (
    v_row.id, 'contact_linked', p_webhook_event_id, left(p_respond_contact_id, 128),
    nullif(left(coalesce(p_message_id, ''), 128), ''), v_occurred_at,
    jsonb_build_object('outcome', 'linked')
  );

  return jsonb_build_object(
    'status', 'contact_linked',
    'attribution_id', v_row.id,
    'respond_contact_id', left(p_respond_contact_id, 128)
  );
end
$$;

create or replace function public.prevent_whatsapp_attribution_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'whatsapp_attribution_history_is_immutable' using errcode = '42501';
end
$$;

create trigger whatsapp_attribution_events_immutable
before update or delete on public.whatsapp_attribution_events
for each row execute function public.prevent_whatsapp_attribution_event_mutation();

revoke all on function public.create_whatsapp_attribution_click(
  uuid, text, text, uuid, text, text, text, text, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.observe_whatsapp_attribution_message(
  text, text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.create_whatsapp_attribution_click(
  uuid, text, text, uuid, text, text, text, text, jsonb, jsonb
) to service_role;
grant execute on function public.observe_whatsapp_attribution_message(
  text, text, text, text, timestamptz
) to service_role;

commit;
