-- Facebook history catch-up. Authenticated admin, encrypted entries only, no grants and no sending.
begin;
create or replace function public.fb_messenger_import_history_v1(
 p_connection uuid,p_actor uuid,p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare item jsonb; inserted_count integer:=0; delta integer;
begin
 if not exists(select 1 from public.profiles p where p.id=p_actor and p.active and p.role_id='admin')
 or not exists(select 1 from facebook_messenger_private.connections c where c.id=p_connection and c.enabled)
 or jsonb_typeof(p_rows) is distinct from 'array'
 or jsonb_array_length(p_rows)>50 then raise exception 'history_denied'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if item->>'connection_id' is distinct from p_connection::text
   or item->>'provider' is distinct from 'facebook_messenger'
   or item->>'channel' is distinct from 'facebook_dm'
   or item->>'kind' not in ('inbound','echo','unsupported')
   or (item->>'occurred_at')::timestamptz < now()-interval '7 days'
   or (item->>'occurred_at')::timestamptz > now()+interval '5 minutes'
   or item->>'event_ref' !~ '^[a-f0-9]{64}$'
   or item->>'thread_ref' !~ '^[a-f0-9]{64}$'
   or item->>'message_ref' !~ '^[a-f0-9]{64}$'
   or not facebook_messenger_private.valid_box(item->'content_box')
   or (item->>'kind'='inbound' and not facebook_messenger_private.valid_box(item->'recipient_box'))
   or (item->>'kind'<>'inbound' and item->'recipient_box' is distinct from 'null'::jsonb)
  then raise exception 'invalid_history'; end if;
  insert into facebook_messenger_private.events(
   connection_id,event_ref,thread_ref,message_ref,kind,occurred_at,content_box,recipient_box
  ) values (
   p_connection,item->>'event_ref',item->>'thread_ref',item->>'message_ref',item->>'kind',
   (item->>'occurred_at')::timestamptz,item->'content_box',nullif(item->'recipient_box','null'::jsonb)
  ) on conflict do nothing;
  get diagnostics delta=row_count; inserted_count:=inserted_count+delta;
  if delta=0 and not exists (
   select 1 from facebook_messenger_private.events e where e.connection_id=p_connection
    and e.event_ref=item->>'event_ref' and e.message_ref=item->>'message_ref'
    and e.thread_ref=item->>'thread_ref' and e.kind=item->>'kind'
  ) then raise exception 'history_conflict'; end if;
 end loop;
 return jsonb_build_object('received',jsonb_array_length(p_rows),'inserted',inserted_count,'duplicates',jsonb_array_length(p_rows)-inserted_count);
end $$;
revoke all on function public.fb_messenger_import_history_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fb_messenger_import_history_v1(uuid,uuid,jsonb) to service_role;
commit;
