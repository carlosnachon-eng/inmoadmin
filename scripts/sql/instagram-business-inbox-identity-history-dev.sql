-- Instagram Business Inbox: internal aliases + bounded history import (DEV)
-- Applied first to inmoadmin-dev for verification. Server-side only.

create table if not exists instagram_business_private.thread_aliases(
  connection_id uuid not null references instagram_business_private.connections(id) on delete cascade,
  thread_ref text not null check(thread_ref~'^[a-f0-9]{64}$'),
  alias text not null check(char_length(alias) between 1 and 80 and alias=btrim(alias) and alias !~ '[[:cntrl:]]'),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(connection_id,thread_ref)
);
alter table instagram_business_private.thread_aliases enable row level security;
revoke all on instagram_business_private.thread_aliases from public,anon,authenticated,service_role;

alter table instagram_business_private.events
  add column if not exists source text not null default 'webhook';
do $$
begin
 if not exists (
   select 1 from pg_constraint
   where conrelid='instagram_business_private.events'::regclass
     and conname='events_source_check'
 ) then
   alter table instagram_business_private.events
     add constraint events_source_check check(source in ('webhook','history_import'));
 end if;
end $$;

create or replace function public.ig_business_thread_alias_v1(
  p_connection uuid,p_thread text,p_actor uuid,p_op text,p_alias text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_alias text;
begin
  if not instagram_business_private.operator(p_actor) then raise exception 'forbidden'; end if;
  if p_thread !~ '^[a-f0-9]{64}$' then raise exception 'bad_thread'; end if;
  if not exists(
    select 1 from instagram_business_private.events e
    join instagram_business_private.connections c on c.id=e.connection_id
    where e.connection_id=p_connection and e.thread_ref=p_thread and c.active
  ) then raise exception 'thread_missing'; end if;

  if p_op='get' then
    select a.alias into v_alias from instagram_business_private.thread_aliases a
    where a.connection_id=p_connection and a.thread_ref=p_thread;
    return jsonb_build_object('alias',v_alias);
  elsif p_op='set' then
    if p_alias is null or btrim(p_alias)='' then
      delete from instagram_business_private.thread_aliases
      where connection_id=p_connection and thread_ref=p_thread;
      return jsonb_build_object('alias',null);
    end if;
    v_alias:=btrim(p_alias);
    if char_length(v_alias)>80 or v_alias ~ '[[:cntrl:]]' then raise exception 'bad_alias'; end if;
    insert into instagram_business_private.thread_aliases(connection_id,thread_ref,alias,updated_by)
    values(p_connection,p_thread,v_alias,p_actor)
    on conflict(connection_id,thread_ref) do update
      set alias=excluded.alias,updated_by=excluded.updated_by,updated_at=clock_timestamp();
    return jsonb_build_object('alias',v_alias);
  else
    raise exception 'bad_op';
  end if;
end $$;

create or replace function public.ig_business_threads_v1(p_connection uuid,p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x order by x.last_activity desc),'[]'::jsonb) from (
 select e.thread_ref,max(e.occurred_at) as last_activity,
        'instagram_login_business'::text as provider,'instagram_dm'::text as thread_type,
        max(a.alias) as alias
 from instagram_business_private.events e
 join instagram_business_private.connections c on c.id=e.connection_id
 left join instagram_business_private.thread_aliases a
   on a.connection_id=e.connection_id and a.thread_ref=e.thread_ref
 where e.connection_id=p_connection and c.active and instagram_business_private.operator(p_actor)
 group by e.thread_ref order by max(e.occurred_at) desc limit 100
 ) x;
$$;

create or replace function public.ig_business_import_history_v1(
  p_connection uuid,p_actor uuid,p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e jsonb;n integer:=0;k integer;
begin
 if not instagram_business_private.operator(p_actor) then raise exception 'forbidden'; end if;
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
  insert into instagram_business_private.events(
   connection_id,event_ref,thread_ref,subject_ref,message_ref,receipt_ref,kind,occurred_at,content_box,recipient_box,source
  )
  values(
   p_connection,e->>'event_ref',e->>'thread_ref',e->>'subject_ref',e->>'message_ref',e->>'receipt_ref',
   e->>'kind',(e->>'occurred_at')::timestamptz,e->'content_box',nullif(e->'recipient_box','null'::jsonb),'history_import'
  ) on conflict do nothing;
  get diagnostics k=row_count;n:=n+k;
 end loop;
 return jsonb_build_object('durable',true,'inserted',n,'duplicates',jsonb_array_length(p_rows)-n);
end $$;

revoke all on function public.ig_business_thread_alias_v1(uuid,text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.ig_business_thread_alias_v1(uuid,text,uuid,text,text) to service_role;
revoke all on function public.ig_business_import_history_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ig_business_import_history_v1(uuid,uuid,jsonb) to service_role;
revoke all on function public.ig_business_threads_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ig_business_threads_v1(uuid,uuid) to service_role;
