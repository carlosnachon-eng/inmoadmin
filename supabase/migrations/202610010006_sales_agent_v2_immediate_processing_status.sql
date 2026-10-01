alter table public.sales_agent_v2_inbound_messages
  drop constraint if exists sales_agent_v2_inbound_messages_status_check;

alter table public.sales_agent_v2_inbound_messages
  add constraint sales_agent_v2_inbound_messages_status_check
  check (status in ('captured','processing','processed','failed','skipped'));

create index if not exists sales_agent_v2_inbound_messages_processing_idx
  on public.sales_agent_v2_inbound_messages(status,occurred_at);
