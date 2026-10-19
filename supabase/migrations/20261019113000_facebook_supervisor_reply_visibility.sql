-- Align supervisor reply eligibility with inbox visibility. Advisors still require
-- exact unexpired thread grants. Existing sender kill-switch, window and durable
-- action gates remain enforced independently by fb_messenger_send_allowed.
create or replace function facebook_messenger_private.allowed(c uuid,t text,a uuid,reply boolean)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(
  select 1 from public.profiles p
  where p.id=a and p.active=true
   and (
    p.role_id in ('admin','gerente_ventas')
    or (p.role_id in ('coord_operaciones','asesor','juridico') and exists(
      select 1 from facebook_messenger_private.thread_grants g
      where g.connection_id=c and g.thread_ref=t and g.actor_id=a
       and g.expires_at>now() and (not reply or g.can_reply)
    ))
   )
   and exists(select 1 from facebook_messenger_private.connections x where x.id=c and x.enabled)
 );
$$;
revoke all on function facebook_messenger_private.allowed(uuid,text,uuid,boolean) from public,anon,authenticated;
