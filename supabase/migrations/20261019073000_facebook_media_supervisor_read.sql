begin;
-- Media reads mirror inbox supervisor visibility, without granting reply privileges.
create or replace function public.fb_messenger_read_v1(p_connection uuid,p_actor uuid,p_input text)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select to_jsonb(e)||jsonb_build_object('provider','facebook_messenger','channel','facebook_dm')
 from facebook_messenger_private.events e
 join facebook_messenger_private.connections c on c.id=e.connection_id
 where c.enabled and e.connection_id=p_connection and e.event_ref=p_input and e.kind='inbound'
 and (
  exists(select 1 from public.profiles p where p.id=p_actor and p.active=true and p.role_id in ('admin','gerente_ventas'))
  or facebook_messenger_private.allowed(p_connection,e.thread_ref,p_actor,false)
 )
 and not exists(select 1 from facebook_messenger_private.events d where d.connection_id=e.connection_id
  and d.message_ref=e.message_ref and d.kind='deleted');
$$;
revoke all on function public.fb_messenger_read_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fb_messenger_read_v1(uuid,uuid,text) to service_role;
commit;
