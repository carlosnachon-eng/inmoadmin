create table if not exists instagram_business_private.comment_events(
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references instagram_business_private.connections(id) on delete cascade,
  event_ref text not null,
  comment_ref text not null,
  media_ref text not null,
  occurred_at timestamptz not null,
  content_box jsonb not null,
  native_box jsonb not null,
  created_at timestamptz not null default now(),
  unique(connection_id,event_ref)
);
create index if not exists comment_events_comment_idx
on instagram_business_private.comment_events(connection_id,comment_ref,occurred_at desc);
create index if not exists comment_events_created_idx
on instagram_business_private.comment_events(connection_id,occurred_at desc);

create table if not exists instagram_business_private.comment_actions(
  action uuid primary key,
  connection_id uuid not null references instagram_business_private.connections(id) on delete cascade,
  comment_ref text not null,
  actor uuid not null references public.profiles(id),
  text_box jsonb not null,
  status text not null check(status in ('reserved','accepted','failed','uncertain')),
  http_status integer null,
  outbound_ref text null,
  reserved_at timestamptz not null default now(),
  finished_at timestamptz null
);
create index if not exists comment_actions_comment_idx
on instagram_business_private.comment_actions(connection_id,comment_ref,reserved_at desc);

alter table instagram_business_private.comment_events enable row level security;
alter table instagram_business_private.comment_actions enable row level security;
drop policy if exists comment_events_service_all on instagram_business_private.comment_events;
drop policy if exists comment_actions_service_all on instagram_business_private.comment_actions;
create policy comment_events_service_all on instagram_business_private.comment_events
for all to service_role using(true) with check(true);
create policy comment_actions_service_all on instagram_business_private.comment_actions
for all to service_role using(true) with check(true);

create or replace function public.ig_business_comment_capture_v1(p_connection uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;n_inserted int:=0;n_duplicates int:=0;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'invalid_rows'; end if;
 if not exists(select 1 from instagram_business_private.connections where id=p_connection and active) then raise exception 'connection_denied'; end if;
 for r in select * from jsonb_array_elements(p_rows) loop
  begin
   insert into instagram_business_private.comment_events(
    connection_id,event_ref,comment_ref,media_ref,occurred_at,content_box,native_box
   ) values(
    p_connection,r->>'event_ref',r->>'comment_ref',r->>'media_ref',
    (r->>'occurred_at')::timestamptz,r->'content_box',r->'native_box'
   );
   n_inserted:=n_inserted+1;
  exception when unique_violation then n_duplicates:=n_duplicates+1;
  end;
 end loop;
 return jsonb_build_object('durable',true,'inserted',n_inserted,'duplicates',n_duplicates);
end;
$$;
revoke all on function public.ig_business_comment_capture_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ig_business_comment_capture_v1(uuid,jsonb) to service_role;

create or replace function public.ig_business_comments_v1(p_connection uuid,p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
with ok as (
 select 1 from public.profiles p
 join instagram_business_private.canary_operators o
  on o.connection_id=p_connection and o.actor=p.id and o.active
 where p.id=p_actor and p.active and p.role_id in ('admin','gerente_ventas')
), latest as (
 select distinct on(e.comment_ref)
  e.id,e.comment_ref,e.media_ref,e.event_ref,e.occurred_at,e.content_box,e.native_box
 from instagram_business_private.comment_events e
 where e.connection_id=p_connection and exists(select 1 from ok)
 order by e.comment_ref,e.occurred_at desc,e.created_at desc
)
select coalesce(jsonb_agg(jsonb_build_object(
 'id',l.id,'comment_ref',l.comment_ref,'media_ref',l.media_ref,'event_ref',l.event_ref,
 'occurred_at',l.occurred_at,'content_box',l.content_box,'native_box',l.native_box,
 'reply_status',(select a.status from instagram_business_private.comment_actions a
  where a.connection_id=p_connection and a.comment_ref=l.comment_ref
  order by a.reserved_at desc limit 1)
) order by l.occurred_at desc),'[]'::jsonb)
from latest l;
$$;
revoke all on function public.ig_business_comments_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ig_business_comments_v1(uuid,uuid) to service_role;

create or replace function public.ig_business_comment_v1(p_connection uuid,p_actor uuid,p_comment text)
returns jsonb language sql stable security definer set search_path='' as $$
with ok as (
 select 1 from public.profiles p
 join instagram_business_private.canary_operators o
  on o.connection_id=p_connection and o.actor=p.id and o.active
 where p.id=p_actor and p.active and p.role_id in ('admin','gerente_ventas')
)
select to_jsonb(x) from (
 select e.id,e.comment_ref,e.media_ref,e.event_ref,e.occurred_at,e.content_box,e.native_box
 from instagram_business_private.comment_events e
 where e.connection_id=p_connection and e.comment_ref=p_comment and exists(select 1 from ok)
 order by e.occurred_at desc,e.created_at desc limit 1
) x;
$$;
revoke all on function public.ig_business_comment_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ig_business_comment_v1(uuid,uuid,text) to service_role;

create or replace function public.ig_business_comment_reserve_v1(
 p_connection uuid,p_actor uuid,p_comment text,p_action uuid,p_text_box jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if not exists(
  select 1 from public.profiles p
  join instagram_business_private.canary_operators o
   on o.connection_id=p_connection and o.actor=p.id and o.active
  where p.id=p_actor and p.active and p.role_id in ('admin','gerente_ventas')
 ) then raise exception 'forbidden'; end if;
 if not exists(select 1 from instagram_business_private.comment_events where connection_id=p_connection and comment_ref=p_comment)
 then raise exception 'comment_missing'; end if;
 insert into instagram_business_private.comment_actions(action,connection_id,comment_ref,actor,text_box,status)
 values(p_action,p_connection,p_comment,p_actor,p_text_box,'reserved')
 on conflict(action) do nothing;
 get diagnostics n=row_count;
 return n=1;
end;
$$;
revoke all on function public.ig_business_comment_reserve_v1(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ig_business_comment_reserve_v1(uuid,uuid,text,uuid,jsonb) to service_role;

create or replace function public.ig_business_comment_finish_v1(
 p_connection uuid,p_action uuid,p_status text,p_http_status integer,p_outbound_ref text
) returns boolean language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_status not in ('accepted','failed','uncertain') then raise exception 'invalid_status'; end if;
 update instagram_business_private.comment_actions
 set status=p_status,http_status=p_http_status,outbound_ref=p_outbound_ref,finished_at=clock_timestamp()
 where connection_id=p_connection and action=p_action and status='reserved';
 get diagnostics n=row_count;
 return n=1;
end;
$$;
revoke all on function public.ig_business_comment_finish_v1(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.ig_business_comment_finish_v1(uuid,uuid,text,integer,text) to service_role;
