alter table public.sales_agent_v2_handoffs
  drop constraint if exists sales_agent_v2_handoffs_status_check;

alter table public.sales_agent_v2_handoffs
  add constraint sales_agent_v2_handoffs_status_check
  check (status in ('ready_for_advisor','assignment_requested','assigned','taken','resolved','cancelled'));

alter table public.sales_agent_v2_handoffs
  add column if not exists ack_message_id text null,
  add column if not exists ack_sent_at timestamptz null,
  add column if not exists assignment_requested_at timestamptz null,
  add column if not exists assignment_error_code text null;

create index if not exists sales_agent_v2_handoffs_assignment_idx
  on public.sales_agent_v2_handoffs(status, assignment_requested_at, created_at desc);
