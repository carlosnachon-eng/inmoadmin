alter table public.service_provider_quote_requests
  add column if not exists quoted_amount numeric null check (quoted_amount is null or quoted_amount >= 0),
  add column if not exists availability_text text null,
  add column if not exists response_parsed boolean not null default false;

comment on column public.service_provider_quote_requests.quoted_amount is
  'Monto aparente extraído de la respuesta del proveedor; no implica aprobación ni adjudicación.';
