-- Identifiable Messenger thread previews when Meta does not provide a user name.
-- Return only encrypted latest events to an authorized actor; service role only.
begin;
create or replace function public.fb_messenger_thread_previews_v1(p_connection uuid,p_actor uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
with authorized as (
 select 1 as ok from public.profiles p where p.id=p_actor and p.active
  and p.role_id in ('admin','coord_operaciones','gerente_ventas','asesor','juridico')
), threads as (
 select distinct on(e.thread_ref)
  e.connection_id,e.thread_ref,e.message_ref,e.event_ref,e.occurred_at,
  e.kind,e.content_box
 from facebook_messenger_private.events e
 where e.connection_id=p_connection
  and exists(select 1 from authorized)
  and (exists(select 1 from public.profiles p where p.id=p_actor and p.active and p.role_id='admin')
       or facebook_messenger_private.allowed(p_connection,e.thread_ref,p_actor,false))
 order by e.thread_ref,e.occurred_at desc,e.event_ref desc
)
select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)
from (select * from threads order by occurred_at desc limit 100) t;
$$;
revoke all on function public.fb_messenger_thread_previews_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fb_messenger_thread_previews_v1(uuid,uuid) to service_role;
commit;
