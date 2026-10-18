create table if not exists instagram_business_private.thread_clients (
  connection_id uuid not null references instagram_business_private.connections(id) on delete cascade,
  thread_ref text not null,
  client_id uuid not null references public.clientes(id) on delete cascade,
  linked_by uuid not null references public.profiles(id),
  linked_at timestamptz not null default now(),
  primary key(connection_id,thread_ref)
);
alter table instagram_business_private.thread_clients enable row level security;

drop policy if exists thread_clients_service_all on instagram_business_private.thread_clients;
create policy thread_clients_service_all
on instagram_business_private.thread_clients
for all
to service_role
using (true)
with check (true);