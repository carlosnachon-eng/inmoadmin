begin;
alter table facebook_messenger_private.credentials add column metadata jsonb not null default '{}'::jsonb;
create function public.fb_messenger_provision_v1(p_connection uuid,p_args jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare n facebook_messenger_private.connections%rowtype; old_generation bigint;
begin
 if not exists(select 1 from public.profiles where id=(p_args->>'actor')::uuid and active and role_id='admin') then return false; end if;
 if p_args->>'app' is null or p_args->>'page' is null or p_args->>'app' !~ '^[0-9]{1,32}$' or p_args->>'page' !~ '^[0-9]{1,32}$'
 or not facebook_messenger_private.valid_box(p_args->'token_box') then return false; end if;
 insert into facebook_messenger_private.connections(id,app_id,page_id)
 values(p_connection,p_args->>'app',p_args->>'page') on conflict(id) do nothing;
 select * into n from facebook_messenger_private.connections where id=p_connection for update;
 if n.app_id is distinct from p_args->>'app' or n.page_id is distinct from p_args->>'page' or n.sender_enabled then return false; end if;
 select generation into old_generation from facebook_messenger_private.credentials where connection_id=p_connection;
 if coalesce(old_generation,0) is distinct from (p_args->>'expected_generation')::bigint
 or (p_args->>'generation')::bigint is distinct from coalesce(old_generation,0)+1 then return false; end if;
 if (p_args->>'verified_at')::timestamptz not between now()-interval '2 minutes' and now()+interval '5 seconds'
 or (p_args->>'valid_until')::timestamptz<=now()+interval '1 minute'
 or (p_args->>'valid_until')::timestamptz>(p_args->>'verified_at')::timestamptz+interval '24 hours'
 or not (p_args->'scopes' @> '["pages_messaging","pages_manage_metadata"]'::jsonb)
 or p_args->'metadata'->>'ok' is distinct from 'true' then return false; end if;
 insert into facebook_messenger_private.credentials(connection_id,token_type,generation,scopes,token_box,verified_at,valid_until,metadata)
 values(p_connection,'PAGE',(p_args->>'generation')::bigint,array(select jsonb_array_elements_text(p_args->'scopes')),
 p_args->'token_box',(p_args->>'verified_at')::timestamptz,(p_args->>'valid_until')::timestamptz,
 jsonb_build_object('expires_at',p_args->'metadata'->'expires_at','data_access_expires_at',p_args->'metadata'->'data_access_expires_at',
 'meta_non_expiring',p_args->'metadata'->'meta_non_expiring','subscribed_fields',p_args->'metadata'->'subscribed_fields'))
 on conflict(connection_id) do update set generation=excluded.generation,scopes=excluded.scopes,token_box=excluded.token_box,
 verified_at=excluded.verified_at,valid_until=excluded.valid_until,metadata=excluded.metadata;
 update facebook_messenger_private.connections set enabled=true,sender_enabled=false where id=p_connection;
 return true;
end $$;
revoke all on function public.fb_messenger_provision_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fb_messenger_provision_v1(uuid,jsonb) to service_role;
commit;
