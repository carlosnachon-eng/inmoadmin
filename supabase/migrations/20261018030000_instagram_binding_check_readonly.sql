-- Temporary, server-only, fixed-event diagnostic. No sender allowlist or journal writes.
begin;
create function public.ig_business_binding_check_input_v1(p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(e)||jsonb_build_object('provider',c.provider,'thread_type','instagram_dm','deleted',false)
 from instagram_business_private.events e
 join instagram_business_private.connections c on c.id=e.connection_id
 where c.id='5f695ba8-eeed-4dd7-8b9d-88b7e3a1327b' and c.active and not c.sender_enabled
 and c.provider='instagram_login_business' and c.app_id='2918004201870607'
 and c.instagram_app_id='2370690620336933' and c.account_id='17841440384433670'
 and e.event_ref='05d762676e7866b7b538a34b1752157425b21ca536a02ac757c7410275c54d21'
 and e.kind='inbound' and e.recipient_box is not null
 and statement_timestamp()<'2026-10-19T02:27:08.193Z'::timestamptz
 and instagram_business_private.operator(c.id,p_actor)
 and exists(select 1 from public.profiles p where p.id=p_actor and p.active and p.role_id='admin')
 and (select count(*) from instagram_business_private.events x where x.connection_id=e.connection_id and x.message_ref=e.message_ref and x.kind='inbound')=1
 and not exists(select 1 from instagram_business_private.events x where x.connection_id=e.connection_id and x.message_ref=e.message_ref and x.kind='unsent')
 and not exists(select 1 from instagram_business_private.actions a where a.connection_id=e.connection_id);
$$;
revoke all on function public.ig_business_binding_check_input_v1(uuid) from public,anon,authenticated;
grant execute on function public.ig_business_binding_check_input_v1(uuid) to service_role;
commit;
