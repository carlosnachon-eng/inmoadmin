create or replace function public.ig_business_import_history_v1(p_connection uuid,p_actor uuid,p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare e jsonb;n integer:=0;k integer;
begin
 if not instagram_business_private.operator(p_connection,p_actor) then raise exception 'forbidden'; end if;
 if not exists(select 1 from instagram_business_private.connections where id=p_connection and active) then raise exception 'connection_denied'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'batch_denied'; end if;
 for e in select value from jsonb_array_elements(p_rows) loop
  if e->>'provider' is distinct from 'instagram_login_business'
   or e->>'connection_id' is distinct from p_connection::text
   or e->>'thread_type' is distinct from 'instagram_dm'
   or e->>'kind' not in ('inbound','echo')
   or (e->>'occurred_at')::timestamptz < clock_timestamp()-interval '7 days'
   or (e->>'occurred_at')::timestamptz > clock_timestamp()+interval '5 minutes'
   or octet_length((e->'content_box')::text)>140000
   or coalesce(e->>'receipt_ref','') !~ '^[a-f0-9]{64}$'
  then raise exception 'scope_denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_connection::text||':'||(e->>'message_ref'),0));
  insert into instagram_business_private.events as current(
   connection_id,event_ref,thread_ref,subject_ref,message_ref,receipt_ref,kind,occurred_at,content_box,recipient_box,source
  ) values(
   p_connection,e->>'event_ref',e->>'thread_ref',e->>'subject_ref',e->>'message_ref',e->>'receipt_ref',
   e->>'kind',(e->>'occurred_at')::timestamptz,e->'content_box',nullif(e->'recipient_box','null'::jsonb),'history_import'
  )
  on conflict (connection_id,event_ref) do update
    set content_box=excluded.content_box,
        recipient_box=excluded.recipient_box
    where current.source='history_import';
  get diagnostics k=row_count;n:=n+k;
 end loop;
 return jsonb_build_object('durable',true,'inserted',n,'duplicates',jsonb_array_length(p_rows)-n);
end $$;
