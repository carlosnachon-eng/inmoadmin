alter table public.service_provider_quote_requests
  add column if not exists provider_reply_message_id uuid null references public.shadow_messages(id) on delete restrict;

create unique index if not exists service_provider_quote_requests_reply_message_uidx
  on public.service_provider_quote_requests(provider_reply_message_id)
  where provider_reply_message_id is not null;
