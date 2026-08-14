-- DEV ONLY. Transactional QA for the Web -> WhatsApp attribution pilot.
begin;

do $$
begin
  if has_table_privilege('public', 'public.whatsapp_attributions', 'select')
     or has_table_privilege('anon', 'public.whatsapp_attributions', 'select')
     or has_table_privilege('authenticated', 'public.whatsapp_attributions', 'select') then
    raise exception 'RLS/grants leak on whatsapp_attributions';
  end if;
  if has_table_privilege('public', 'public.whatsapp_attribution_events', 'select')
     or has_table_privilege('anon', 'public.whatsapp_attribution_events', 'select')
     or has_table_privilege('authenticated', 'public.whatsapp_attribution_events', 'select') then
    raise exception 'RLS/grants leak on whatsapp_attribution_events';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.create_whatsapp_attribution_click(uuid,text,text,uuid,text,text,text,text,jsonb,jsonb)',
    'execute'
  ) then
    raise exception 'service_role missing click RPC';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.observe_whatsapp_attribution_message(text,text,text,text,timestamptz)',
    'execute'
  ) then
    raise exception 'authenticated can execute attribution receiver RPC';
  end if;
end
$$;

set local role service_role;

do $$
declare
  v_click jsonb;
  v_duplicate jsonb;
  v_link jsonb;
  v_replay jsonb;
  v_second jsonb;
  v_count bigint;
begin
  select public.create_whatsapp_attribution_click(
    '91000000-0000-4000-8000-000000000001',
    'ABCDE-FGHJK-MNPQR-STVWZ',
    '/propiedades/qa-DEV-GV-001',
    '30000000-0000-4000-8000-000000000001',
    'DEV-GV-001',
    'qa-DEV-GV-001',
    'property_lease',
    'property_contact_card_whatsapp',
    '{"source":"tiktok","medium":"paid_social","landing_path":"/propiedades/qa","seen_at":"2026-08-14T12:00:00Z"}',
    '{"source":"tiktok","medium":"paid_social","landing_path":"/propiedades/qa","seen_at":"2026-08-14T12:00:00Z"}'
  ) into v_click;
  if v_click ->> 'status' <> 'created' then raise exception 'click not created'; end if;

  select public.create_whatsapp_attribution_click(
    '91000000-0000-4000-8000-000000000001',
    '12345-6789A-BCDEF-GHJKM',
    '/propiedades/qa-DEV-GV-001',
    '30000000-0000-4000-8000-000000000001',
    'DEV-GV-001',
    'qa-DEV-GV-001',
    'property_lease',
    'property_contact_card_whatsapp',
    '{"source":"direct","medium":"(none)","landing_path":"/propiedades/qa","seen_at":"2026-08-14T12:00:00Z"}',
    '{"source":"direct","medium":"(none)","landing_path":"/propiedades/qa","seen_at":"2026-08-14T12:00:00Z"}'
  ) into v_duplicate;
  if v_duplicate ->> 'status' <> 'deduplicated'
     or v_duplicate ->> 'reference_code' <> 'ABCDE-FGHJK-MNPQR-STVWZ' then
    raise exception 'request idempotency failed';
  end if;

  select public.observe_whatsapp_attribution_message(
    'ABCDE-FGHJK-MNPQR-STVWZ', 'qa-webhook-1', 'qa-contact-1', 'qa-message-1', now()
  ) into v_link;
  if v_link ->> 'status' <> 'contact_linked' then raise exception 'contact not linked'; end if;

  select public.observe_whatsapp_attribution_message(
    'ABCDE-FGHJK-MNPQR-STVWZ', 'qa-webhook-1', 'qa-contact-1', 'qa-message-1', now()
  ) into v_replay;
  if v_replay ->> 'status' <> 'duplicate_event' then raise exception 'event dedupe failed'; end if;

  select public.create_whatsapp_attribution_click(
    '91000000-0000-4000-8000-000000000002',
    '12345-6789A-BCDEF-GHJKM',
    '/propiedades/qa-DEV-GV-002',
    '30000000-0000-4000-8000-000000000002',
    'DEV-GV-002',
    'qa-DEV-GV-002',
    'property_sale',
    'property_contact_card_whatsapp',
    '{"source":"google","medium":"organic","landing_path":"/propiedades/qa","seen_at":"2026-08-14T12:00:00Z"}',
    '{"source":"google","medium":"organic","landing_path":"/propiedades/qa","seen_at":"2026-08-14T12:00:00Z"}'
  ) into v_second;
  perform public.observe_whatsapp_attribution_message(
    '12345-6789A-BCDEF-GHJKM', 'qa-webhook-2', 'qa-contact-1', 'qa-message-2', now()
  );

  select count(*) into v_count
  from public.whatsapp_attributions
  where respond_contact_id = 'qa-contact-1';
  if v_count <> 2 then raise exception 'multiple intents for one contact not preserved'; end if;

  if exists (
    select 1 from public.whatsapp_attribution_events
    where metadata ? 'message' or metadata ? 'body' or metadata ? 'text'
  ) then
    raise exception 'message body leaked to attribution history';
  end if;

  begin
    update public.whatsapp_attribution_events
    set metadata = '{"mutated":true}'
    where webhook_event_id = 'qa-webhook-1';
    raise exception 'immutable history allowed update';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;

rollback;
