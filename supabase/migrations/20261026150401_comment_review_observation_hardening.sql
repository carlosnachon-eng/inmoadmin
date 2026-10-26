-- Additive function replacement; no data deletion, channel or secret changes.
begin;
create or replace function public.comment_review_v1(p_platform text,p_connection uuid,p_actor uuid,p_op text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r commercial_comment_private.reviews; e commercial_comment_private.events; inserted integer; result jsonb;
begin
 if p_op is null or p_op not in ('capture','list','events','evaluate','approve') or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'operation_denied';end if;
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
  if r.status='approved' then return jsonb_build_object('status','unchanged');end if;
  -- Revalidate stale proposals only after the server has read current evidence.
  -- Replace the encrypted decision and audit the refresh; never extend approvals.
  if r.revision=p_data->>'revision' and r.updated_at>=clock_timestamp()-interval '5 minutes' then return jsonb_build_object('status','unchanged');end if;
  if p_data->>'status' not in ('proposed','escalated','ignored','suppressed') then raise exception 'status_denied';end if;
  insert into commercial_comment_private.reviews(platform,connection_id,comment_ref,event_ref,revision,status,reason,decision_box,opportunity)
   values(p_platform,p_connection,e.comment_ref,e.event_ref,p_data->>'revision',p_data->>'status',p_data->>'reason',p_data->'decision_box',coalesce((p_data->>'opportunity')::boolean,false))
   on conflict(platform,connection_id,comment_ref) do update set event_ref=excluded.event_ref,revision=excluded.revision,status=excluded.status,reason=excluded.reason,
   decision_box=excluded.decision_box,opportunity=excluded.opportunity,approval_box=null,approved_by=null,approved_at=null,updated_at=clock_timestamp();
 elsif p_op='approve' then
  if r.comment_ref is null or r.status is distinct from 'proposed' or r.revision is distinct from p_data->>'revision' or r.updated_at<clock_timestamp()-interval '5 minutes' then return jsonb_build_object('status','stale_or_blocked');end if;
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

commit;
