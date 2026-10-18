begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Server-only read boundary; API pins operator, connection, input, thread and expiry.
-- No grant creation, mutation, claim or sender operation.
create function public.fb_messenger_canary_preflight_v1(p_connection uuid,p_actor uuid,p_input text,p_thread text)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('event',to_jsonb(e)||jsonb_build_object('provider','facebook_messenger','channel','facebook_dm'),
 'credential',public.fb_messenger_credential_v1(p_connection))
 from facebook_messenger_private.events e join facebook_messenger_private.connections c on c.id=e.connection_id
 where c.id=p_connection and c.enabled and not c.sender_enabled
 and e.event_ref=p_input and e.thread_ref=p_thread and e.kind='inbound'
 and exists(select 1 from public.profiles p where p.id=p_actor and p.active and p.role_id='admin')
 and not exists(select 1 from facebook_messenger_private.actions a where a.connection_id=c.id and a.input_ref=e.event_ref)
 and not exists(select 1 from facebook_messenger_private.events d where d.connection_id=c.id and d.message_ref=e.message_ref and d.kind='deleted');
$$;
revoke all on function public.fb_messenger_canary_preflight_v1(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.fb_messenger_canary_preflight_v1(uuid,uuid,text,text) to service_role;
commit;
