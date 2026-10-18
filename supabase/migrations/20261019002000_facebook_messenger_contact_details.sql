-- Facebook contact fields. Service-only, encrypted at rest, exact authorized thread.
begin;
alter table facebook_messenger_private.thread_names
 add column if not exists phone_box jsonb,
 add column if not exists email_box jsonb;
alter table facebook_messenger_private.thread_names
 drop constraint if exists fb_thread_names_contact_boxes_check;
alter table facebook_messenger_private.thread_names
 add constraint fb_thread_names_contact_boxes_check check(
 (phone_box is null or facebook_messenger_private.valid_box(phone_box))
 and (email_box is null or facebook_messenger_private.valid_box(email_box))
);

create or replace function public.fb_messenger_contact_save_v1(
 p_connection uuid,p_thread text,p_actor uuid,p_phone jsonb,p_email jsonb
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_thread !~ '^[a-f0-9]{64}$'
 or (p_phone is not null and not facebook_messenger_private.valid_box(p_phone))
 or (p_email is not null and not facebook_messenger_private.valid_box(p_email))
 or not exists(select 1 from public.profiles where id=p_actor and active and role_id='admin')
 or not exists(select 1 from facebook_messenger_private.events where connection_id=p_connection and thread_ref=p_thread)
 then return false; end if;
 insert into facebook_messenger_private.thread_names(connection_id,thread_ref,phone_box,email_box)
 values(p_connection,p_thread,p_phone,p_email)
 on conflict(connection_id,thread_ref) do update
 set phone_box=excluded.phone_box,email_box=excluded.email_box,updated_at=clock_timestamp();
 return true;
end $$;
revoke all on function public.fb_messenger_contact_save_v1(uuid,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fb_messenger_contact_save_v1(uuid,text,uuid,jsonb,jsonb) to service_role;

create or replace function public.fb_messenger_contact_get_v1(
 p_connection uuid,p_thread text,p_actor uuid
) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select to_jsonb(n)
 from facebook_messenger_private.thread_names n
 where n.connection_id=p_connection and n.thread_ref=p_thread
 and exists(select 1 from public.profiles p where p.id=p_actor and p.active
  and (p.role_id='admin' or facebook_messenger_private.allowed(p_connection,p_thread,p_actor,false)));
$$;
revoke all on function public.fb_messenger_contact_get_v1(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.fb_messenger_contact_get_v1(uuid,text,uuid) to service_role;
commit;
