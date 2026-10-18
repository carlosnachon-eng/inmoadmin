begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table facebook_messenger_private.health (
 connection_id uuid primary key references facebook_messenger_private.connections(id),
 run_id uuid, locked_until timestamptz, next_check_at timestamptz not null default now(),
 checked_at timestamptz, status text not null default 'pending' check(status in ('pending','running','healthy','unhealthy','conflict')),
 stage text, http_status integer, error_code bigint, error_subcode bigint
);
alter table facebook_messenger_private.health enable row level security;
revoke all on facebook_messenger_private.health from public,anon,authenticated,service_role;
-- Service-only scheduler, not an impersonated human. No HTTP while holding locks.
create function public.fb_messenger_health_begin_v1(p_connection uuid,p_run uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare h facebook_messenger_private.health%rowtype;
begin
 if p_run is null then return null; end if;
 perform 1 from facebook_messenger_private.connections where id=p_connection and enabled for update;
 if not found then return null; end if;
 insert into facebook_messenger_private.health(connection_id) values(p_connection) on conflict do nothing;
 select * into h from facebook_messenger_private.health where connection_id=p_connection for update;
 if h.locked_until>now() or h.next_check_at>now() then return null; end if;
 if not exists(select 1 from facebook_messenger_private.credentials where connection_id=p_connection) then
  update facebook_messenger_private.connections set sender_enabled=false where id=p_connection;
  update facebook_messenger_private.health set status='unhealthy',stage='credential_missing',checked_at=now(),next_check_at=now()+interval '1 hour' where connection_id=p_connection;
  return jsonb_build_object('health_error','credential_missing');
 end if;
 update facebook_messenger_private.health set run_id=p_run,locked_until=now()+interval '2 minutes',status='running' where connection_id=p_connection;
 return public.fb_messenger_credential_v1(p_connection);
end $$;
create function public.fb_messenger_health_finish_v1(p_connection uuid,p_run uuid,p_args jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare h facebook_messenger_private.health%rowtype; k facebook_messenger_private.credentials%rowtype; m jsonb:=p_args->'metadata';
begin
 perform 1 from facebook_messenger_private.connections where id=p_connection for update;
 select * into h from facebook_messenger_private.health where connection_id=p_connection for update;
 if not found or h.run_id is distinct from p_run or h.locked_until<=now() or h.status<>'running' then return false; end if;
 select * into k from facebook_messenger_private.credentials where connection_id=p_connection for update;
 if not found or k.generation is distinct from (p_args->>'expected_generation')::bigint then
  update facebook_messenger_private.health set status='conflict',locked_until=null,next_check_at=now()+interval '1 minute' where connection_id=p_connection;
  return false;
 end if;
 if p_args->>'ok' is distinct from 'true' then
  update facebook_messenger_private.connections set sender_enabled=false where id=p_connection;
  update facebook_messenger_private.health set status='unhealthy',stage=case when p_args->>'stage' ~ '^[a-z_]{1,40}$' then p_args->>'stage' else 'validation_failed' end,
   http_status=(p_args->>'http_status')::integer,error_code=(p_args->>'code')::bigint,error_subcode=(p_args->>'subcode')::bigint,
   checked_at=now(),locked_until=null,next_check_at=now()+interval '1 hour' where connection_id=p_connection;
  return true;
 end if;
 -- Do not rotate the encrypted local lease underneath an in-flight manual action.
 if exists(select 1 from facebook_messenger_private.actions where connection_id=p_connection and state='claimed' and claimed_at>now()-interval '1 minute') then
  update facebook_messenger_private.health set status='conflict',locked_until=null,next_check_at=now()+interval '1 minute' where connection_id=p_connection;
  return false;
 end if;
 if (p_args->>'generation')::bigint is distinct from k.generation+1
 or not facebook_messenger_private.valid_box(p_args->'token_box')
 or (p_args->>'verified_at')::timestamptz is null or (p_args->>'valid_until')::timestamptz is null
 or (p_args->>'verified_at')::timestamptz not between now()-interval '2 minutes' and now()+interval '5 seconds'
 or (p_args->>'valid_until')::timestamptz<=now()+interval '1 minute'
 or (p_args->>'valid_until')::timestamptz>(p_args->>'verified_at')::timestamptz+interval '24 hours'
 or coalesce(p_args->'scopes' @> '["pages_messaging","pages_manage_metadata"]'::jsonb,false)=false
 or m->>'ok' is distinct from 'true' or m->>'inbound_ready' is distinct from 'true' or m->>'echo_ready' is distinct from 'true'
 then return false; end if;
 update facebook_messenger_private.credentials set generation=(p_args->>'generation')::bigint,
  scopes=array(select jsonb_array_elements_text(p_args->'scopes')),token_box=p_args->'token_box',
  verified_at=(p_args->>'verified_at')::timestamptz,valid_until=(p_args->>'valid_until')::timestamptz,
  metadata=jsonb_build_object('expires_at',m->'expires_at','data_access_expires_at',m->'data_access_expires_at','meta_non_expiring',m->'meta_non_expiring','subscribed_fields',m->'subscribed_fields')
 where connection_id=p_connection;
 update facebook_messenger_private.health set status='healthy',stage='verified',checked_at=now(),locked_until=null,
 next_check_at=least(now()+interval '6 hours',(p_args->>'valid_until')::timestamptz-interval '1 hour'),http_status=null,error_code=null,error_subcode=null where connection_id=p_connection;
 -- Never enable a connection, sender or grant. Success after failure stays closed.
 return true;
end $$;
revoke all on function public.fb_messenger_health_begin_v1(uuid,uuid),public.fb_messenger_health_finish_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fb_messenger_health_begin_v1(uuid,uuid),public.fb_messenger_health_finish_v1(uuid,uuid,jsonb) to service_role;
commit;
