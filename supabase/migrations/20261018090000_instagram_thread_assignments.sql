create table if not exists instagram_business_private.thread_assignments (
  connection_id uuid not null references instagram_business_private.connections(id) on delete cascade,
  thread_ref text not null,
  advisor_id uuid not null references public.profiles(id),
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  primary key(connection_id,thread_ref)
);
alter table instagram_business_private.thread_assignments enable row level security;

drop policy if exists thread_assignments_service_all on instagram_business_private.thread_assignments;
create policy thread_assignments_service_all
on instagram_business_private.thread_assignments
for all
to service_role
using (true)
with check (true);