-- DEV-only deployment. Additive reader; existing send/grant checks remain unchanged.
begin;
create function public.fb_messenger_inbox_v1(p_connection uuid,p_actor uuid,p_thread text default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','coord_operaciones','gerente_ventas','asesor','juridico'))
 or not exists(select 1 from facebook_messenger_private.connections where id=p_connection and enabled) then return null; end if;
 -- Preserve exact expiring grants, including for administrators. No role bypass.
 if p_thread is not null and not facebook_messenger_private.allowed(p_connection,p_thread,p_actor,false) then return null; end if;
 if p_thread is null then
  select coalesce(jsonb_agg(to_jsonb(t) order by t.occurred_at desc,t.thread_ref),'[]'::jsonb) into result from (
   select e.thread_ref,max(e.occurred_at) as occurred_at from facebook_messenger_private.events e
   where e.connection_id=p_connection and facebook_messenger_private.allowed(p_connection,e.thread_ref,p_actor,false)
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
end $$;
revoke all on function public.fb_messenger_inbox_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fb_messenger_inbox_v1(uuid,uuid,text) to service_role;
commit;
