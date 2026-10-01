alter table public.sales_agent_v2_handoffs
  add column if not exists reassignment_count integer not null default 0
    check (reassignment_count >= 0 and reassignment_count <= 10),
  add column if not exists last_reassignment_at timestamptz null,
  add column if not exists last_human_outbound_at timestamptz null,
  add column if not exists sla_due_at timestamptz null;

update public.sales_agent_v2_handoffs
set sla_due_at = assignment_requested_at + interval '10 minutes'
where assignment_requested_at is not null
  and sla_due_at is null
  and status in ('assignment_requested','assigned');

create index if not exists sales_agent_v2_handoffs_sla_idx
  on public.sales_agent_v2_handoffs(status,sla_due_at)
  where status in ('assignment_requested','assigned');
