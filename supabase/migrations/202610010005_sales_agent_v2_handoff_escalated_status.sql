alter table public.sales_agent_v2_handoffs
  drop constraint if exists sales_agent_v2_handoffs_status_check;

alter table public.sales_agent_v2_handoffs
  add constraint sales_agent_v2_handoffs_status_check
  check (status in ('ready_for_advisor','assignment_requested','assigned','taken','escalated','resolved','cancelled'));
