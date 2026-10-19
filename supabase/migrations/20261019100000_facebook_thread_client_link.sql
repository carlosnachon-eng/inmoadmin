-- Messenger-specific CRM relationship. Never reuse Instagram thread grants.
create table if not exists facebook_messenger_private.thread_clients (
 connection_id uuid not null references facebook_messenger_private.connections(id),
 thread_ref text not null check(thread_ref ~ '^[a-f0-9]{64}$'),
 client_id uuid not null references public.clientes(id),
 linked_by uuid not null references public.profiles(id),
 linked_at timestamptz not null default now(),
 primary key(connection_id,thread_ref)
);
alter table facebook_messenger_private.thread_clients enable row level security;
revoke all on facebook_messenger_private.thread_clients from public,anon,authenticated;
create or replace function public.fb_messenger_thread_client_v1(p_connection uuid,p_thread text,p_actor uuid,p_op text,p_client uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare current_id uuid;
begin
 if p_thread !~ '^[a-f0-9]{64}$' or not exists(
  select 1 from facebook_messenger_private.connections c where c.id=p_connection and c.enabled)
  or not exists(select 1 from public.profiles p where p.id=p_actor and p.active and
   p.role_id in ('admin','gerente_ventas','asesor','coord_operaciones','juridico'))
  or not (exists(select 1 from public.profiles p where p.id=p_actor and p.active and p.role_id in ('admin','gerente_ventas'))
   or facebook_messenger_private.allowed(p_connection,p_thread,p_actor,false))
  or not exists(select 1 from facebook_messenger_private.events e where e.connection_id=p_connection and e.thread_ref=p_thread)
 then raise exception 'forbidden';end if;
 if p_op='set' then
  if p_client is null or not exists(select 1 from public.clientes where id=p_client) then raise exception 'client_missing';end if;
  insert into facebook_messenger_private.thread_clients(connection_id,thread_ref,client_id,linked_by)
  values(p_connection,p_thread,p_client,p_actor)
  on conflict(connection_id,thread_ref) do update set client_id=excluded.client_id,linked_by=excluded.linked_by,linked_at=now();
 elsif p_op<>'get' then raise exception 'invalid_op';end if;
 select client_id into current_id from facebook_messenger_private.thread_clients where connection_id=p_connection and thread_ref=p_thread;
 return jsonb_build_object('client_id',current_id);
end $$;
revoke all on function public.fb_messenger_thread_client_v1(uuid,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.fb_messenger_thread_client_v1(uuid,text,uuid,text,uuid) to service_role;
