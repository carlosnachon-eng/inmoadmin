-- Match Instagram's assignable roles while keeping Facebook's conversation-scoped grants.
create or replace function public.fb_messenger_assign_thread_v1(
 p_connection uuid,p_thread text,p_actor uuid,p_advisor uuid
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_thread !~ '^[a-f0-9]{64}$' then return false; end if;
 if not exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','gerente_ventas')) then return false; end if;
 if not exists(select 1 from public.profiles p
   where p.id=p_advisor and p.active
   and (p.role_id in ('admin','gerente_ventas')
     or (p.role_id='asesor' and p.id in
      (select advisor_profile_id from public.v_sales_team_directory where left_at is null)))) then return false; end if;
 if not exists(select 1 from facebook_messenger_private.connections
   where id=p_connection and enabled) then return false; end if;
 if not exists(select 1 from facebook_messenger_private.events
   where connection_id=p_connection and thread_ref=p_thread and kind='inbound') then return false; end if;
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
