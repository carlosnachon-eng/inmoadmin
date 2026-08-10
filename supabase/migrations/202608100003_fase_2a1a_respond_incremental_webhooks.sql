begin;

alter table public.gv_respond_contact_snapshots
  add column if not exists sales_relevant boolean not null default true,
  add column if not exists respond_record_active boolean not null default true,
  add column if not exists respond_blocked boolean not null default false,
  add column if not exists exclusion_reason text,
  add column if not exists deactivated_at timestamptz,
  add column if not exists last_seen_respond_at timestamptz,
  add column if not exists last_event_at timestamptz;

create index if not exists gv_respond_snapshots_work_center_idx
  on public.gv_respond_contact_snapshots
    (mapped_profile_id, respond_conversation_status, respond_unanswered_since)
  where sales_relevant = true
    and respond_record_active = true
    and respond_blocked = false;

create table if not exists public.gv_respond_webhook_events (
  event_id text primary key,
  event_type text not null check (
    event_type in (
      'contact.created',
      'contact.updated',
      'contact.assignee.updated',
      'contact.lifecycle.updated',
      'conversation.opened',
      'conversation.closed',
      'message.received',
      'message.sent'
    )
  ),
  respond_contact_id text not null,
  event_occurred_at timestamptz,
  message_id text,
  payload_meta jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload_meta) = 'object'),
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'retry', 'processed', 'dead_letter')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by uuid,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

create index if not exists gv_respond_webhook_events_pending_idx
  on public.gv_respond_webhook_events (status, next_attempt_at, received_at);

create index if not exists gv_respond_webhook_events_contact_idx
  on public.gv_respond_webhook_events (respond_contact_id, status, received_at);

alter table public.gv_respond_webhook_events enable row level security;

revoke all on table public.gv_respond_webhook_events from public, anon, authenticated;
grant select, insert, update, delete on table public.gv_respond_webhook_events to service_role;

create or replace function public.claim_respond_webhook_contacts(
  p_worker_id uuid,
  p_limit integer default 20,
  p_received_before timestamptz default now()
)
returns table (
  respond_contact_id text,
  event_ids text[],
  event_count integer,
  latest_event_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_worker_id is null then
    raise exception 'worker_id_required' using errcode = '22023';
  end if;

  p_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  update public.gv_respond_webhook_events
  set status = 'retry',
      next_attempt_at = now(),
      locked_at = null,
      locked_by = null,
      last_error = left(coalesce(last_error || '; ', '') || 'stale_lock_recovered', 500)
  where status = 'processing'
    and locked_at < now() - interval '10 minutes';

  return query
  with candidates as (
    select q.respond_contact_id,
           min(q.received_at) as first_received_at
    from public.gv_respond_webhook_events q
    where q.status in ('pending', 'retry')
      and q.next_attempt_at <= now()
      and q.received_at <= coalesce(p_received_before, now())
      and not exists (
        select 1
        from public.gv_respond_webhook_events processing
        where processing.respond_contact_id = q.respond_contact_id
          and processing.status = 'processing'
      )
    group by q.respond_contact_id
    order by min(q.received_at)
    limit p_limit * 3
  ),
  locked_contacts as (
    select candidate.respond_contact_id
    from candidates candidate
    where pg_try_advisory_xact_lock(hashtextextended(candidate.respond_contact_id, 0))
    order by candidate.first_received_at
    limit p_limit
  ),
  claimed as (
    update public.gv_respond_webhook_events q
    set status = 'processing',
        attempts = q.attempts + 1,
        locked_at = now(),
        locked_by = p_worker_id,
        last_error = null
    from locked_contacts contact
    where q.respond_contact_id = contact.respond_contact_id
      and q.status in ('pending', 'retry')
      and q.next_attempt_at <= now()
      and q.received_at <= coalesce(p_received_before, now())
    returning q.respond_contact_id,
              q.event_id,
              coalesce(q.event_occurred_at, q.received_at) as effective_event_at
  )
  select claimed.respond_contact_id,
         array_agg(claimed.event_id order by claimed.event_id),
         count(*)::integer,
         max(claimed.effective_event_at)
  from claimed
  group by claimed.respond_contact_id;
end
$$;

create or replace function public.apply_respond_snapshot_and_complete_events(
  p_snapshot jsonb,
  p_event_ids text[],
  p_worker_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_expected integer;
  v_snapshot jsonb;
begin
  if p_worker_id is null or coalesce(cardinality(p_event_ids), 0) = 0 then
    raise exception 'worker_and_event_ids_required' using errcode = '22023';
  end if;
  if cardinality(p_event_ids) <> (
    select count(distinct item.event_id)::integer
    from unnest(p_event_ids) as item(event_id)
  ) then
    raise exception 'duplicate_event_ids' using errcode = '22023';
  end if;

  select count(*)::integer
  into v_expected
  from public.gv_respond_webhook_events
  where event_id = any(p_event_ids)
    and status = 'processing'
    and locked_by = p_worker_id;

  if v_expected <> cardinality(p_event_ids) then
    raise exception 'events_not_owned_by_worker' using errcode = '55000';
  end if;

  if p_snapshot is not null then
    if nullif(p_snapshot ->> 'respond_contact_id', '') is null then
      raise exception 'snapshot_contact_id_required' using errcode = '22023';
    end if;

    insert into public.gv_respond_contact_snapshots (
      respond_contact_id,
      respond_assignee_id,
      respond_assignee_email,
      mapped_profile_id,
      mapping_status,
      respond_channel_id,
      respond_channel_source,
      respond_conversation_status,
      respond_lifecycle,
      respond_last_inbound_at,
      respond_last_outbound_at,
      respond_last_human_outbound_at,
      respond_last_ai_outbound_at,
      respond_unanswered_since,
      respond_last_synced_at,
      atn_area,
      atn_servicio,
      atn_estado,
      atn_destino,
      atn_proxima_accion,
      atn_fecha_proxima_accion,
      atn_sla_vencido,
      ven_presupuesto_compra,
      ven_renta_mensual_objetivo,
      ven_plazo,
      inm_tipo,
      inm_zona,
      sales_relevant,
      respond_record_active,
      respond_blocked,
      exclusion_reason,
      deactivated_at,
      last_seen_respond_at,
      last_event_at,
      metadata,
      updated_at
    ) values (
      p_snapshot ->> 'respond_contact_id',
      nullif(p_snapshot ->> 'respond_assignee_id', ''),
      nullif(p_snapshot ->> 'respond_assignee_email', ''),
      nullif(p_snapshot ->> 'mapped_profile_id', '')::uuid,
      coalesce(nullif(p_snapshot ->> 'mapping_status', ''), 'unmatched'),
      nullif(p_snapshot ->> 'respond_channel_id', ''),
      nullif(p_snapshot ->> 'respond_channel_source', ''),
      nullif(p_snapshot ->> 'respond_conversation_status', ''),
      nullif(p_snapshot ->> 'respond_lifecycle', ''),
      nullif(p_snapshot ->> 'respond_last_inbound_at', '')::timestamptz,
      nullif(p_snapshot ->> 'respond_last_outbound_at', '')::timestamptz,
      nullif(p_snapshot ->> 'respond_last_human_outbound_at', '')::timestamptz,
      nullif(p_snapshot ->> 'respond_last_ai_outbound_at', '')::timestamptz,
      nullif(p_snapshot ->> 'respond_unanswered_since', '')::timestamptz,
      coalesce(nullif(p_snapshot ->> 'respond_last_synced_at', '')::timestamptz, now()),
      nullif(p_snapshot ->> 'atn_area', ''),
      nullif(p_snapshot ->> 'atn_servicio', ''),
      nullif(p_snapshot ->> 'atn_estado', ''),
      nullif(p_snapshot ->> 'atn_destino', ''),
      nullif(p_snapshot ->> 'atn_proxima_accion', ''),
      nullif(p_snapshot ->> 'atn_fecha_proxima_accion', '')::date,
      nullif(p_snapshot ->> 'atn_sla_vencido', '')::boolean,
      nullif(p_snapshot ->> 'ven_presupuesto_compra', '')::numeric,
      nullif(p_snapshot ->> 'ven_renta_mensual_objetivo', '')::numeric,
      nullif(p_snapshot ->> 'ven_plazo', ''),
      nullif(p_snapshot ->> 'inm_tipo', ''),
      nullif(p_snapshot ->> 'inm_zona', ''),
      coalesce((p_snapshot ->> 'sales_relevant')::boolean, true),
      coalesce((p_snapshot ->> 'respond_record_active')::boolean, true),
      coalesce((p_snapshot ->> 'respond_blocked')::boolean, false),
      nullif(p_snapshot ->> 'exclusion_reason', ''),
      nullif(p_snapshot ->> 'deactivated_at', '')::timestamptz,
      nullif(p_snapshot ->> 'last_seen_respond_at', '')::timestamptz,
      nullif(p_snapshot ->> 'last_event_at', '')::timestamptz,
      coalesce(p_snapshot -> 'metadata', '{}'::jsonb),
      coalesce(nullif(p_snapshot ->> 'updated_at', '')::timestamptz, now())
    )
    on conflict (respond_contact_id) do update
    set respond_assignee_id = excluded.respond_assignee_id,
        respond_assignee_email = excluded.respond_assignee_email,
        mapped_profile_id = excluded.mapped_profile_id,
        mapping_status = excluded.mapping_status,
        respond_channel_id = excluded.respond_channel_id,
        respond_channel_source = excluded.respond_channel_source,
        respond_conversation_status = excluded.respond_conversation_status,
        respond_lifecycle = excluded.respond_lifecycle,
        respond_last_inbound_at = excluded.respond_last_inbound_at,
        respond_last_outbound_at = excluded.respond_last_outbound_at,
        respond_last_human_outbound_at = excluded.respond_last_human_outbound_at,
        respond_last_ai_outbound_at = excluded.respond_last_ai_outbound_at,
        respond_unanswered_since = excluded.respond_unanswered_since,
        respond_last_synced_at = excluded.respond_last_synced_at,
        atn_area = excluded.atn_area,
        atn_servicio = excluded.atn_servicio,
        atn_estado = excluded.atn_estado,
        atn_destino = excluded.atn_destino,
        atn_proxima_accion = excluded.atn_proxima_accion,
        atn_fecha_proxima_accion = excluded.atn_fecha_proxima_accion,
        atn_sla_vencido = excluded.atn_sla_vencido,
        ven_presupuesto_compra = excluded.ven_presupuesto_compra,
        ven_renta_mensual_objetivo = excluded.ven_renta_mensual_objetivo,
        ven_plazo = excluded.ven_plazo,
        inm_tipo = excluded.inm_tipo,
        inm_zona = excluded.inm_zona,
        sales_relevant = excluded.sales_relevant,
        respond_record_active = excluded.respond_record_active,
        respond_blocked = excluded.respond_blocked,
        exclusion_reason = excluded.exclusion_reason,
        deactivated_at = excluded.deactivated_at,
        last_seen_respond_at = excluded.last_seen_respond_at,
        last_event_at = excluded.last_event_at,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    returning to_jsonb(gv_respond_contact_snapshots) into v_snapshot;
  end if;

  update public.gv_respond_webhook_events
  set status = 'processed',
      processed_at = now(),
      next_attempt_at = now(),
      locked_at = null,
      locked_by = null,
      last_error = null
  where event_id = any(p_event_ids)
    and status = 'processing'
    and locked_by = p_worker_id;

  return v_snapshot;
end
$$;

create or replace function public.fail_respond_webhook_events(
  p_event_ids text[],
  p_worker_id uuid,
  p_error text,
  p_max_attempts integer default 8
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
begin
  if p_worker_id is null or coalesce(cardinality(p_event_ids), 0) = 0 then
    raise exception 'worker_and_event_ids_required' using errcode = '22023';
  end if;

  update public.gv_respond_webhook_events
  set status = case when attempts >= greatest(coalesce(p_max_attempts, 8), 1)
                    then 'dead_letter' else 'retry' end,
      next_attempt_at = case
        when attempts >= greatest(coalesce(p_max_attempts, 8), 1) then now()
        else now() + make_interval(mins => case attempts
          when 1 then 1
          when 2 then 5
          when 3 then 15
          else 60
        end)
      end,
      locked_at = null,
      locked_by = null,
      last_error = left(coalesce(nullif(p_error, ''), 'worker_failed'), 500)
  where event_id = any(p_event_ids)
    and status = 'processing'
    and locked_by = p_worker_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end
$$;

revoke all on function public.claim_respond_webhook_contacts(uuid, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.apply_respond_snapshot_and_complete_events(jsonb, text[], uuid)
  from public, anon, authenticated;
revoke all on function public.fail_respond_webhook_events(text[], uuid, text, integer)
  from public, anon, authenticated;

grant execute on function public.claim_respond_webhook_contacts(uuid, integer, timestamptz)
  to service_role;
grant execute on function public.apply_respond_snapshot_and_complete_events(jsonb, text[], uuid)
  to service_role;
grant execute on function public.fail_respond_webhook_events(text[], uuid, text, integer)
  to service_role;

commit;
