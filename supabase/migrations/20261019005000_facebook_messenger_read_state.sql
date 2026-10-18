-- Read state within Inmoadmin (not a Meta read receipt).
begin;
create table if not exists facebook_messenger_private.thread_read_state(
 connection_id uuid not null references facebook_messenger_private.connections(id),
 thread_ref text not null check(thread_ref ~ '^[a-f0-9]{64}$'),
 actor_id uuid not null references public.profiles(id),
 read_at timestamptz not null default clock_timestamp(),
 primary key(connection_id,thread_ref,actor_id)
);
alter table facebook_messenger_private.thread_read_state enable row level security;
revoke all on facebook_messenger_private.thread_read_state from public,anon,authenticated,service_role;

create or replace function public.fb_messenger_read_state_v1(
 p_connection uuid,p_actor uuid,p_thread text default null,p_op text default 'list'
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare is_admin boolean; result jsonb;
begin
 select exists(select 1 from public.profiles p where p.id=p_actor and p.active and p.role_id='admin') into is_admin;
 if not exists(select 1 from public.profiles p where p.id=p_actor and p.active
  and p.role_id in ('admin','coord_operaciones','gerente_ventas','asesor','juridico'))
 or not exists(select 1 from facebook_messenger_private.connections c where c.id=p_connection and c.enabled)
 then return null; end if;
 if p_op='mark' then
  if p_thread is null or p_thread !~ '^[a-f0-9]{64}$'
  or not (is_admin or facebook_messenger_private.allowed(p_connection,p_thread,p_actor,false))
  or not exists(select 1 from facebook_messenger_private.events e
   where e.connection_id=p_connection and e.thread_ref=p_thread)
  then return null; end if;
  insert into facebook_messenger_private.thread_read_state(connection_id,thread_ref,actor_id,read_at)
   values(p_connection,p_thread,p_actor,clock_timestamp())
   on conflict(connection_id,thread_ref,actor_id) do update set read_at=excluded.read_at;
  return jsonb_build_object('status','marked');
 elsif p_op='list' and p_thread is null then
  select coalesce(jsonb_agg(jsonb_build_object(
   'thread_ref',latest.thread_ref,'last_inbound_at',latest.last_inbound_at,
   'read_at',r.read_at
  )),'[]'::jsonb) into result
  from (
   select e.thread_ref,max(e.occurred_at) filter(where e.kind='inbound') as last_inbound_at
   from facebook_messenger_private.events e
   where e.connection_id=p_connection
    and (is_admin or facebook_messenger_private.allowed(p_connection,e.thread_ref,p_actor,false))
   group by e.thread_ref
   order by max(e.occurred_at) desc limit 100
  ) latest left join facebook_messenger_private.thread_read_state r
   on r.connection_id=p_connection and r.thread_ref=latest.thread_ref and r.actor_id=p_actor;
  return jsonb_build_object('rows',result);
 end if;
 return null;
end $$;
revoke all on function public.fb_messenger_read_state_v1(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.fb_messenger_read_state_v1(uuid,uuid,text,text) to service_role;
commit;
