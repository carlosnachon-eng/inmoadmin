alter table public.service_provider_quote_requests
  add column if not exists reminder_sent_at timestamptz null,
  add column if not exists escalated_at timestamptz null,
  add column if not exists reminder_message_id text null;

alter table public.service_provider_quote_requests
  drop constraint if exists service_provider_quote_requests_status_check;

alter table public.service_provider_quote_requests
  add constraint service_provider_quote_requests_status_check
  check (status = any (array['draft'::text,'sent'::text,'responded'::text,'cancelled'::text,'failed'::text,'no_response'::text]));

create index if not exists service_provider_quote_requests_sla_idx
  on public.service_provider_quote_requests(status,sent_at,reminder_sent_at)
  where status='sent';