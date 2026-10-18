-- Facebook Messenger staff assignments: additive, service-only, OFF until UI/API authorization is reviewed.
-- Never create a cross-channel identity match or grant all advisors all threads.
begin;
create table if not exists facebook_messenger_private.thread_assignments(
 connection_id uuid not null references facebook_messenger_private.connections(id),
 thread_ref text not null check(thread_ref ~ '^[a-f0-9]{64}$'),
 advisor_id uuid not null references public.profiles(id),
 assigned_by uuid not null references public.profiles(id),
 assigned_at timestamptz not null default clock_timestamp(),
 primary key(connection_id,thread_ref)
);
alter table facebook_messenger_private.thread_assignments enable row level security;
revoke all on facebook_messenger_private.thread_assignments from public,anon,authenticated,service_role;

-- This records an assignment only. It deliberately does NOT authorize an outbound sender.
-- Explicit thread grants continue to be required for reading and replying.
create or replace function public.fb_messenger_assign_thread_v1(
 p_connection uuid,p_thread text,p_actor uuid,p_advisor uuid
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_thread !~ '^[a-f0-9]{64}$' then return false; end if;
 if not exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','gerente_ventas')) then return false; end if;
 if not exists(select 1 from public.profiles p
   where p.id=p_advisor and p.active and p.role_id='asesor'
   and p.id in (select advisor_profile_id from public.v_sales_team_directory)) then return false; end if;
 if not exists(select 1 from facebook_messenger_private.connections
   where id=p_connection and enabled) then return false; end if;
 if not exists(select 1 from facebook_messenger_private.events
   where connection_id=p_connection and thread_ref=p_thread and kind='inbound') then return false; end if;
 -- Serialize manager changes per thread and avoid two advisors with simultaneous access.
 perform pg_advisory_xact_lock(hashtextextended(p_connection::text||':'||p_thread,0));
 delete from facebook_messenger_private.thread_grants g
 where g.connection_id=p_connection and g.thread_ref=p_thread
   and g.actor_id in (select advisor_id from facebook_messenger_private.thread_assignments
                      where connection_id=p_connection and thread_ref=p_thread)
   and g.actor_id<>p_advisor;
 insert into facebook_messenger_private.thread_assignments(connection_id,thread_ref,advisor_id,assigned_by)
 values(p_connection,p_thread,p_advisor,p_actor)
 on conflict(connection_id,thread_ref) do update
 set advisor_id=excluded.advisor_id,assigned_by=excluded.assigned_by,assigned_at=clock_timestamp();
 insert into facebook_messenger_private.thread_grants(connection_id,thread_ref,actor_id,expires_at,can_reply)
 values(p_connection,p_thread,p_advisor,now()+interval '7 days',true)
 on conflict(connection_id,thread_ref,actor_id) do update set expires_at=excluded.expires_at,can_reply=true;
 return true;
end $$;
revoke all on function public.fb_messenger_assign_thread_v1(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fb_messenger_assign_thread_v1(uuid,text,uuid,uuid) to service_role;
-- Read-only supervisory visibility for unassigned threads; does not grant reply rights.
create or replace function public.fb_messenger_inbox_v1(p_connection uuid,p_actor uuid,p_thread text default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $inbox$
declare result jsonb; is_supervisor boolean;
begin
 if not exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','coord_operaciones','gerente_ventas','asesor','juridico'))
 or not exists(select 1 from facebook_messenger_private.connections where id=p_connection and enabled) then return null; end if;
 select exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','gerente_ventas')) into is_supervisor;
 -- Supervisors may review/unassign threads; outbound still needs the exact thread grant.
 if p_thread is not null and not (is_supervisor or facebook_messenger_private.allowed(p_connection,p_thread,p_actor,false)) then return null; end if;
 if p_thread is null then
  select coalesce(jsonb_agg(to_jsonb(t) order by t.occurred_at desc,t.thread_ref),'[]'::jsonb) into result from (
   select e.thread_ref,max(e.occurred_at) as occurred_at from facebook_messenger_private.events e
   where e.connection_id=p_connection and (is_supervisor or facebook_messenger_private.allowed(p_connection,e.thread_ref,p_actor,false))
   group by e.thread_ref order by max(e.occurred_at) desc,e.thread_ref limit 100
  ) t;
 else
  select coalesce(jsonb_agg(to_jsonb(t) order by t.occurred_at,t.event_ref),'[]'::jsonb) into result from (
   select e.*,a.state as action_state,
    exists(select 1 from facebook_messenger_private.events d where d.connection_id=e.connection_id and d.message_ref=e.message_ref and d.kind='deleted') as deleted,
    facebook_messenger_private.allowed(p_connection,e.thread_ref,p_actor,true) and e.occurred_at>now()-interval '23 hours' and e.occurred_at<=now() as reply_allowed
   from facebook_messenger_private.events e left join facebook_messenger_private.actions a on a.connection_id=e.connection_id and a.input_ref=e.event_ref
   where e.connection_id=p_connection and e.thread_ref=p_thread
   order by e.occurred_at desc,e.event_ref desc limit 200
  ) t;
 end if;
 return jsonb_build_object('rows',result,'sender_enabled',(select sender_enabled from facebook_messenger_private.connections where id=p_connection));
end $inbox$;
revoke all on function public.fb_messenger_inbox_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fb_messenger_inbox_v1(uuid,uuid,text) to service_role;

commit;
