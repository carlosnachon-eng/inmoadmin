-- Additive, closed-by-default review journal. No trigger on operational channels.
begin;
create schema if not exists commercial_comment_private;
revoke all on schema commercial_comment_private from public,anon,authenticated,service_role;
create table commercial_comment_private.connections(
 platform text not null check(platform in ('instagram','facebook')), connection_id uuid not null,
 active boolean not null default false, sender_enabled boolean not null default false,
 primary key(platform,connection_id));
create table commercial_comment_private.events(
 platform text not null, connection_id uuid not null, event_ref text not null check(event_ref~'^[a-f0-9]{64}$'),
 comment_ref text not null check(comment_ref~'^[a-f0-9]{64}$'), post_ref text not null check(post_ref~'^[a-f0-9]{64}$'),
 occurred_at timestamptz not null, deleted boolean not null default false,
 content_box jsonb not null check(jsonb_typeof(content_box)='object'),
 native_box jsonb not null check(jsonb_typeof(native_box)='object'),
 received_at timestamptz not null default clock_timestamp(),
 primary key(platform,connection_id,event_ref),foreign key(platform,connection_id) references commercial_comment_private.connections);
create index comment_events_latest on commercial_comment_private.events(platform,connection_id,comment_ref,occurred_at desc);
create table commercial_comment_private.reviews(
 platform text not null, connection_id uuid not null, comment_ref text not null,
 event_ref text not null, revision text not null check(revision~'^[a-f0-9]{64}$'),
 status text not null check(status in ('proposed','escalated','ignored','suppressed','approved','claimed','accepted','uncertain')),
 reason text not null check(reason~'^[a-z_]{1,80}$'), decision_box jsonb not null,
 approval_box jsonb, approved_by uuid, approved_at timestamptz,
 opportunity boolean not null default false, destination text not null default 'SALES' check(destination='SALES'),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(platform,connection_id,comment_ref),
 foreign key(platform,connection_id,event_ref) references commercial_comment_private.events);
create table commercial_comment_private.audit(
 id bigint generated always as identity primary key,platform text not null,connection_id uuid not null,
 comment_ref text not null,revision text not null,actor uuid,kind text not null,
 occurred_at timestamptz not null default clock_timestamp());
create index comment_audit_scope on commercial_comment_private.audit(platform,connection_id,comment_ref,id);
create table commercial_comment_private.actions(
 platform text not null,connection_id uuid not null,comment_ref text not null,
 action uuid not null unique,revision text not null,actor uuid not null,
 status text not null check(status in ('claimed','started','accepted','uncertain')),
 claimed_at timestamptz not null default clock_timestamp(),started_at timestamptz,
 primary key(platform,connection_id,comment_ref),
 foreign key(platform,connection_id,comment_ref) references commercial_comment_private.reviews);
alter table commercial_comment_private.connections enable row level security;
alter table commercial_comment_private.events enable row level security;
alter table commercial_comment_private.reviews enable row level security;
alter table commercial_comment_private.audit enable row level security;
alter table commercial_comment_private.actions enable row level security;
revoke all on all tables in schema commercial_comment_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema commercial_comment_private from public,anon,authenticated,service_role;

-- Server calls only. Actor comes from getUser+active profile, never client body.
create function public.comment_review_v1(p_platform text,p_connection uuid,p_actor uuid,p_op text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r commercial_comment_private.reviews; e commercial_comment_private.events; inserted integer; result jsonb;
begin
 if p_op<>'capture' and not exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','gerente_ventas')) then raise exception 'forbidden' using errcode='42501';end if;
 if not exists(select 1 from commercial_comment_private.connections where platform=p_platform and connection_id=p_connection and active) then raise exception 'connection_closed' using errcode='42501';end if;
 if p_op='list' then
  select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc),'[]') into result from (
   select * from commercial_comment_private.reviews where platform=p_platform and connection_id=p_connection order by updated_at desc limit 200) t;
  return result;
 end if;
 if p_op='events' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (
   select distinct on(comment_ref) * from commercial_comment_private.events where platform=p_platform and connection_id=p_connection
   order by comment_ref,occurred_at desc,deleted desc,event_ref limit 200) t;
  return result;
 end if;
 if p_op='capture' then
  insert into commercial_comment_private.events(platform,connection_id,event_ref,comment_ref,post_ref,occurred_at,deleted,content_box,native_box)
  values(p_platform,p_connection,p_data->>'event_ref',p_data->>'comment_ref',p_data->>'post_ref',(p_data->>'occurred_at')::timestamptz,
   coalesce((p_data->>'deleted')::boolean,false),p_data->'content_box',p_data->'native_box') on conflict do nothing;
  get diagnostics inserted=row_count;return jsonb_build_object('inserted',inserted);
 end if;
 -- One lock shared by evaluation and approval; no network inside transaction.
 perform pg_advisory_xact_lock(hashtextextended(p_platform||p_connection::text||(p_data->>'comment_ref'),0));
 select * into r from commercial_comment_private.reviews where platform=p_platform and connection_id=p_connection and comment_ref=p_data->>'comment_ref' for update;
 if p_op='evaluate' then
  select * into e from commercial_comment_private.events where platform=p_platform and connection_id=p_connection and comment_ref=p_data->>'comment_ref'
   order by occurred_at desc,deleted desc,event_ref desc limit 1;
  if e.event_ref is distinct from p_data->>'event_ref' or e.deleted then return jsonb_build_object('status','stale_or_deleted');end if;
  if r.status in ('claimed','accepted','uncertain') then return jsonb_build_object('status','consumed');end if;
  if r.revision=p_data->>'revision' then return jsonb_build_object('status','unchanged');end if;
  if p_data->>'status' not in ('proposed','escalated','ignored','suppressed') then raise exception 'status_denied';end if;
  insert into commercial_comment_private.reviews(platform,connection_id,comment_ref,event_ref,revision,status,reason,decision_box,opportunity)
   values(p_platform,p_connection,e.comment_ref,e.event_ref,p_data->>'revision',p_data->>'status',p_data->>'reason',p_data->'decision_box',coalesce((p_data->>'opportunity')::boolean,false))
   on conflict(platform,connection_id,comment_ref) do update set event_ref=excluded.event_ref,revision=excluded.revision,status=excluded.status,reason=excluded.reason,
   decision_box=excluded.decision_box,opportunity=excluded.opportunity,approval_box=null,approved_by=null,approved_at=null,updated_at=clock_timestamp();
 elsif p_op='approve' then
  if r.status<>'proposed' or r.revision is distinct from p_data->>'revision' or r.updated_at<clock_timestamp()-interval '5 minutes' then return jsonb_build_object('status','stale_or_blocked');end if;
  if exists(select 1 from commercial_comment_private.events where platform=p_platform and connection_id=p_connection and comment_ref=r.comment_ref and (deleted or event_ref<>r.event_ref)) then return jsonb_build_object('status','changed_event');end if;
  if jsonb_typeof(p_data->'approval_box') is distinct from 'object' then raise exception 'approval_shape';end if;
  update commercial_comment_private.reviews set status='approved',approval_box=p_data->'approval_box',approved_by=p_actor,approved_at=clock_timestamp(),updated_at=clock_timestamp()
   where platform=p_platform and connection_id=p_connection and comment_ref=r.comment_ref;
 else raise exception 'operation_denied';end if;
 insert into commercial_comment_private.audit(platform,connection_id,comment_ref,revision,actor,kind)
 values(p_platform,p_connection,p_data->>'comment_ref',p_data->>'revision',p_actor,p_op);
 return jsonb_build_object('status',case when p_op='approve' then 'approved_not_sent' else 'recorded' end);
end $$;
revoke all on function public.comment_review_v1(text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.comment_review_v1(text,uuid,uuid,text,jsonb) to service_role;
-- Prepared lifecycle only. No route calls it and no connection is enabled by this migration.
create function public.comment_action_v1(p_platform text,p_connection uuid,p_actor uuid,p_comment text,p_revision text,p_action uuid,p_op text)
returns boolean language plpgsql security definer set search_path='' as $$
declare count_changed integer;
begin
 if not exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','gerente_ventas')) then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_platform||p_connection::text||p_comment,0));
 if p_op in ('claim','start') then
  if not exists(select 1 from commercial_comment_private.connections where platform=p_platform and connection_id=p_connection and active and sender_enabled) then return false;end if;
  if not exists(select 1 from commercial_comment_private.reviews r where r.platform=p_platform and r.connection_id=p_connection and r.comment_ref=p_comment and r.revision=p_revision and r.approved_by=p_actor and r.approved_at>clock_timestamp()-interval '5 minutes' and r.status in ('approved','claimed')) then return false;end if;
  if exists(select 1 from commercial_comment_private.events e join commercial_comment_private.reviews r using(platform,connection_id,comment_ref)
   where e.platform=p_platform and e.connection_id=p_connection and e.comment_ref=p_comment and (e.deleted or e.event_ref<>r.event_ref)) then return false;end if;
 end if;
 if p_op='claim' then
  insert into commercial_comment_private.actions(platform,connection_id,comment_ref,action,revision,actor,status)
  values(p_platform,p_connection,p_comment,p_action,p_revision,p_actor,'claimed') on conflict do nothing;
  get diagnostics count_changed=row_count;
  if count_changed=1 then update commercial_comment_private.reviews set status='claimed' where platform=p_platform and connection_id=p_connection and comment_ref=p_comment;end if;
 elsif p_op='start' then
  update commercial_comment_private.actions set status='started',started_at=clock_timestamp() where platform=p_platform and connection_id=p_connection and comment_ref=p_comment and action=p_action and actor=p_actor and revision=p_revision and status='claimed';
  get diagnostics count_changed=row_count;
 elsif p_op in ('accepted','uncertain') then
  update commercial_comment_private.actions set status=p_op where platform=p_platform and connection_id=p_connection and comment_ref=p_comment and action=p_action and actor=p_actor and revision=p_revision and status='started';
  get diagnostics count_changed=row_count;
  if count_changed=1 then update commercial_comment_private.reviews set status=p_op where platform=p_platform and connection_id=p_connection and comment_ref=p_comment;end if;
 else return false;end if;
 if count_changed=1 then insert into commercial_comment_private.audit(platform,connection_id,comment_ref,revision,actor,kind) values(p_platform,p_connection,p_comment,p_revision,p_actor,p_op);end if;
 return count_changed=1;
end $$;
revoke all on function public.comment_action_v1(text,uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.comment_action_v1(text,uuid,uuid,text,text,uuid,text) to service_role;
commit;
