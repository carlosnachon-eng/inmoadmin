alter table public.sales_agent_v2_inbound_messages
  add column if not exists debounce_until timestamptz null;

update public.sales_agent_v2_inbound_messages
set debounce_until = created_at
where debounce_until is null;

create index if not exists sales_agent_v2_inbound_messages_debounce_idx
  on public.sales_agent_v2_inbound_messages(status,debounce_until,occurred_at);
