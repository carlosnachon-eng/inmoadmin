-- Attribution-safe outgoing directions for Respond Admin webhooks.
-- This migration changes only the accepted direction enum; it does not rewrite history.
begin;

alter table public.shadow_messages
  drop constraint if exists shadow_messages_direction_check;

alter table public.shadow_messages
  add constraint shadow_messages_direction_check check (direction in (
    'inbound', 'outbound', 'outbound_human',
    'outbound_ai_inmoadmin', 'outbound_respond_ai', 'outbound_unknown'
  ));

commit;
