-- Explicit names for Messenger threads. AES-GCM values stay encrypted at rest.
begin;
create table if not exists facebook_messenger_private.thread_names (
 connection_id uuid not null references facebook_messenger_private.connections(id),
 thread_ref text not null check(thread_ref ~ '^[a-f0-9]{64}$'),
 alias_box jsonb,
 profile_box jsonb,
 updated_at timestamptz not null default clock_timestamp(),
 primary key(connection_id,thread_ref),
 check(alias_box is null or facebook_messenger_private.valid_box(alias_box)),
 check(profile_box is null or facebook_messenger_private.valid_box(profile_box))
);
alter table facebook_messenger_private.thread_names enable row level security;
revoke all on facebook_messenger_private.thread_names from public,anon,authenticated,service_role;

create or replace function public.fb_messenger_name_save_v1(
 p_connection uuid,p_thread text,p_actor uuid,p_kind text,p_box jsonb
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_kind not in ('alias','profile') or p_thread !~ '^[a-f0-9]{64}$'
 or not facebook_messenger_private.valid_box(p_box)
 or not exists(select 1 from public.profiles where id=p_actor and active and role_id='admin')
 or not exists(select 1 from facebook_messenger_private.events where connection_id=p_connection and thread_ref=p_thread)
 then return false; end if;
 insert into facebook_messenger_private.thread_names(connection_id,thread_ref,alias_box,profile_box)
 values(p_connection,p_thread,case when p_kind='alias' then p_box else null end,case when p_kind='profile' then p_box else null end)
 on conflict(connection_id,thread_ref) do update set
 alias_box=case when p_kind='alias' then excluded.alias_box else facebook_messenger_private.thread_names.alias_box end,
 profile_box=case when p_kind='profile' then excluded.profile_box else facebook_messenger_private.thread_names.profile_box end,
 updated_at=clock_timestamp();
 return true;
end $$;
revoke all on function public.fb_messenger_name_save_v1(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.fb_messenger_name_save_v1(uuid,text,uuid,text,jsonb) to service_role;

create or replace function public.fb_messenger_names_v1(p_connection uuid,p_actor uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'thread_ref',n.thread_ref,'alias_box',n.alias_box,'profile_box',n.profile_box
 )),'[]'::jsonb)
 from facebook_messenger_private.thread_names n
 where n.connection_id=p_connection and exists(
  select 1 from public.profiles p
  where p.id=p_actor and p.active and (
   p.role_id='admin' or facebook_messenger_private.allowed(p_connection,n.thread_ref,p_actor,false)
  )
 );
$$;
revoke all on function public.fb_messenger_names_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fb_messenger_names_v1(uuid,uuid) to service_role;
commit;
