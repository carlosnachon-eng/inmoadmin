begin;

create table if not exists instagram_business_private.comment_automations(
  connection_id uuid not null references instagram_business_private.connections(id) on delete cascade,
  comment_ref text not null,
  media_ref text not null,
  event_ref text not null,
  classification text not null check(classification in ('commercial','review','ignored','expired')),
  rule text not null,
  status text not null check(status in ('reserved','dm_sent','review','ignored','expired','failed','uncertain')),
  http_status integer null,
  outbound_ref text null,
  created_at timestamptz not null default now(),
  finished_at timestamptz null,
  primary key(connection_id,comment_ref)
);

create index if not exists comment_automations_status_idx
on instagram_business_private.comment_automations(connection_id,status,created_at desc);

alter table instagram_business_private.comment_automations enable row level security;
drop policy if exists comment_automations_service_all on instagram_business_private.comment_automations;
create policy comment_automations_service_all on instagram_business_private.comment_automations
for all to service_role using(true) with check(true);

create or replace function public.ig_business_comment_automation_reserve_v1(
 p_connection uuid,p_comment text,p_media text,p_event text,p_classification text,p_rule text
) returns boolean language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_classification not in ('commercial','review','ignored','expired') then raise exception 'invalid_classification'; end if;
 if not exists(select 1 from instagram_business_private.comment_events where connection_id=p_connection and comment_ref=p_comment)
 then raise exception 'comment_missing'; end if;
 insert into instagram_business_private.comment_automations(
  connection_id,comment_ref,media_ref,event_ref,classification,rule,status,finished_at
 ) values(
  p_connection,p_comment,p_media,p_event,p_classification,p_rule,
  case p_classification when 'commercial' then 'reserved' when 'review' then 'review' when 'ignored' then 'ignored' else 'expired' end,
  case when p_classification='commercial' then null else clock_timestamp() end
 )
 on conflict(connection_id,comment_ref) do nothing;
 get diagnostics n=row_count;
 return n=1;
end;
$$;
revoke all on function public.ig_business_comment_automation_reserve_v1(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.ig_business_comment_automation_reserve_v1(uuid,text,text,text,text,text) to service_role;

create or replace function public.ig_business_comment_automation_finish_v1(
 p_connection uuid,p_comment text,p_status text,p_http_status integer,p_outbound_ref text
) returns boolean language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_status not in ('dm_sent','failed','uncertain') then raise exception 'invalid_status'; end if;
 update instagram_business_private.comment_automations
 set status=p_status,http_status=p_http_status,outbound_ref=p_outbound_ref,finished_at=clock_timestamp()
 where connection_id=p_connection and comment_ref=p_comment and status='reserved';
 get diagnostics n=row_count;
 return n=1;
end;
$$;
revoke all on function public.ig_business_comment_automation_finish_v1(uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.ig_business_comment_automation_finish_v1(uuid,text,text,integer,text) to service_role;

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
  order by a.reserved_at desc limit 1),
 'automation_status',ca.status,
 'automation_classification',ca.classification,
 'automation_rule',ca.rule
) order by l.occurred_at desc),'[]'::jsonb)
from latest l
left join instagram_business_private.comment_automations ca
 on ca.connection_id=p_connection and ca.comment_ref=l.comment_ref;
$$;
revoke all on function public.ig_business_comments_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ig_business_comments_v1(uuid,uuid) to service_role;

commit;