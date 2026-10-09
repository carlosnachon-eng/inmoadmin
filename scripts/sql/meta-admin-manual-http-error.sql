-- Proposed additive migration. Install before the manual runtime change.
-- Existing journal ACL/RLS, attention, dispatch and success RPC remain unchanged.
begin;
alter table meta_admin_private.manual_events add column http_error jsonb;
alter table meta_admin_private.manual_events add constraint manual_http_error_shape check (
 http_error is null or (
 phase='outcome' and status in ('failed','uncertain') and native_wamid is null
 and jsonb_typeof(http_error)='object' and pg_column_size(http_error)<=2048
 and http_error ?& array['http_status','code','subcode','type','message','details']
 and http_error-array['http_status','code','subcode','type','message','details']='{}'::jsonb
 and jsonb_typeof(http_error->'http_status')='number'
 and (http_error->>'http_status')::integer between 300 and 599
 and (http_error->'code'='null'::jsonb or (jsonb_typeof(http_error->'code')='number' and (http_error->>'code')::bigint between 0 and 2147483647))
 and (http_error->'subcode'='null'::jsonb or (jsonb_typeof(http_error->'subcode')='number' and (http_error->>'subcode')::bigint between 0 and 2147483647))
 and (http_error->'type'='null'::jsonb or http_error->>'type' in ('OAuthException','GraphMethodException','APIException','FacebookApiException'))
 and (http_error->'message'='null'::jsonb or (jsonb_typeof(http_error->'message')='string' and length(http_error->>'message')<=500))
 and (http_error->'details'='null'::jsonb or (jsonb_typeof(http_error->'details')='string' and length(http_error->>'details')<=500))
 ));
create function public.meta_admin_manual_finish_http_error_v1(p_action_id uuid,p_token uuid,p_status text,p_http_error jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_status is null or p_status not in ('failed','uncertain') or p_http_error is null
   or not exists(select 1 from meta_admin_private.manual_actions where action_id=p_action_id and token=p_token)
   or not exists(select 1 from meta_admin_private.manual_events where action_id=p_action_id and phase='dispatch_started') then return false;end if;
 insert into meta_admin_private.manual_events(action_id,phase,status,http_error)
 values(p_action_id,'outcome',p_status,p_http_error) on conflict do nothing;
 return found;
end $$;
revoke all on function public.meta_admin_manual_finish_http_error_v1(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_manual_finish_http_error_v1(uuid,uuid,text,jsonb) to service_role;
commit;
