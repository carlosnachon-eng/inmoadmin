-- Read-only, service-role-only history of manual public replies.
-- Reuses encrypted text_box; never stores or exposes plaintext in SQL.
begin;
create or replace function public.ig_business_comment_replies_v1(
 p_connection uuid,p_actor uuid,p_comment text
) returns jsonb language sql stable security definer set search_path='' as $$
select coalesce((
 select jsonb_agg(jsonb_build_object(
  'action',a.action,'actor',a.actor,'actor_name',coalesce(p.full_name,p.email,'Operador'),
  'text_box',a.text_box,'status',a.status,
  'reserved_at',a.reserved_at,'finished_at',a.finished_at
 ) order by a.reserved_at,a.action)
 from (
  select a.action,a.actor,a.text_box,a.status,a.reserved_at,a.finished_at
  from instagram_business_private.comment_actions a
  where a.connection_id=p_connection and a.comment_ref=p_comment
  order by a.reserved_at desc,a.action desc limit 50
 ) a
 left join public.profiles p on p.id=a.actor
 where exists(
  select 1 from instagram_business_private.comment_events e
  where e.connection_id=p_connection and e.comment_ref=p_comment
 )
 and exists(
  select 1 from public.profiles operator
  join instagram_business_private.canary_operators o
   on o.connection_id=p_connection and o.actor=operator.id and o.active
  where operator.id=p_actor and operator.active
   and operator.role_id in ('admin','gerente_ventas')
 )
),'[]'::jsonb);
$$;
revoke all on function public.ig_business_comment_replies_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ig_business_comment_replies_v1(uuid,uuid,text) to service_role;
commit;
