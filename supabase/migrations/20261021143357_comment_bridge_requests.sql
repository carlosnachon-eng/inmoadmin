-- Preview bridge replay fence. No change to messaging gates, keys or existing RLS.
begin;
create table commercial_comment_private.bridge_requests (
 connection_id uuid not null,
 nonce uuid not null,
 actor_id uuid not null,
 received_at timestamptz not null default clock_timestamp(),
 primary key(connection_id,nonce)
);
alter table commercial_comment_private.bridge_requests enable row level security;
revoke all on commercial_comment_private.bridge_requests from public,anon,authenticated,service_role;
create function public.comment_bridge_request_v1(p_connection uuid,p_actor uuid,p_nonce uuid,p_timestamp bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare inserted integer;
begin
 if p_nonce is null or p_timestamp is null or abs(extract(epoch from clock_timestamp())-p_timestamp)>30 then return false;end if;
 if not exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','gerente_ventas')) then
  raise exception using errcode='42501',message='review_actor_denied';
 end if;
 if not exists(select 1 from commercial_comment_private.connections where platform='instagram' and connection_id=p_connection and active and not sender_enabled) then return false;end if;
 insert into commercial_comment_private.bridge_requests(connection_id,nonce,actor_id) values(p_connection,p_nonce,p_actor) on conflict do nothing;
 get diagnostics inserted=row_count;
 return inserted=1;
end $$;
revoke all on function public.comment_bridge_request_v1(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.comment_bridge_request_v1(uuid,uuid,uuid,bigint) to service_role;
commit;
