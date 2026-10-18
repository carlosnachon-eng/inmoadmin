create or replace function public.ig_business_comment_automation_candidates_v1(
 p_connection uuid,p_limit integer default 10
) returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at asc),'[]'::jsonb)
from (
 select e.id,e.comment_ref,e.media_ref,e.event_ref,e.occurred_at,e.content_box,e.native_box
 from instagram_business_private.comment_events e
 left join instagram_business_private.comment_automations a
  on a.connection_id=e.connection_id and a.comment_ref=e.comment_ref
 where e.connection_id=p_connection
   and a.comment_ref is null
 order by e.occurred_at asc,e.created_at asc
 limit greatest(1,least(coalesce(p_limit,10),25))
) x;
$$;
revoke all on function public.ig_business_comment_automation_candidates_v1(uuid,integer) from public,anon,authenticated;
grant execute on function public.ig_business_comment_automation_candidates_v1(uuid,integer) to service_role;