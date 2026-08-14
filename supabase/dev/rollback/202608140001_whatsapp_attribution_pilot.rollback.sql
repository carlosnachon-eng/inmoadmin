-- DEV ONLY. Removes only the Web -> WhatsApp attribution pilot structures.

begin;

drop function if exists public.observe_whatsapp_attribution_message(
  text, text, text, text, timestamptz
);
drop function if exists public.create_whatsapp_attribution_click(
  uuid, text, text, uuid, text, text, text, text, jsonb, jsonb
);
drop trigger if exists whatsapp_attribution_events_immutable
  on public.whatsapp_attribution_events;
drop function if exists public.prevent_whatsapp_attribution_event_mutation();
drop table if exists public.whatsapp_attribution_events;
drop table if exists public.whatsapp_attributions;

commit;
