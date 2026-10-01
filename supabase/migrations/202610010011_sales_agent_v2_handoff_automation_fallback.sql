alter table public.sales_agent_v2_handoffs
  drop constraint if exists sales_agent_v2_handoffs_reason_check;

alter table public.sales_agent_v2_handoffs
  add constraint sales_agent_v2_handoffs_reason_check
  check (reason in (
    'appointment_intent',
    'reservation_intent',
    'negotiation_intent',
    'financing_intent',
    'specific_property_high_interest',
    'human_requested',
    'automation_fallback'
  ));