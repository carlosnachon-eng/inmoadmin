-- Phase 1, additive only. Not applied remotely by this PR. No seed assets/tokens/grants.
begin;
create schema facebook_messenger_private;
revoke all on schema facebook_messenger_private from public,anon,authenticated,service_role;

create function facebook_messenger_private.valid_box(b jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(b)='object' and b->>'provider'='facebook_messenger' and b->>'v'='1'
 and b->>'iv' ~ '^[a-f0-9]{24}$' and b->>'tag' ~ '^[a-f0-9]{32}$'
 and b->>'data' ~ '^([a-f0-9]{2})+$' and length(b->>'data')<=131072,false);
$$;

create table facebook_messenger_private.connections (
 id uuid primary key,
 provider text not null default 'facebook_messenger' check(provider='facebook_messenger'),
 app_id text not null check(app_id ~ '^[0-9]{1,32}$'),
 page_id text not null check(page_id ~ '^[0-9]{1,32}$'),
 enabled boolean not null default false,
 sender_enabled boolean not null default false,
 unique(app_id,page_id)
);
create table facebook_messenger_private.credentials (
 connection_id uuid primary key references facebook_messenger_private.connections(id),
 token_type text not null check(token_type='PAGE'),
 generation bigint not null check(generation>0),
 scopes text[] not null check(scopes @> array['pages_messaging']),
 token_box jsonb not null check(facebook_messenger_private.valid_box(token_box)),
 verified_at timestamptz not null,
 -- Explicit conservative lease, including for tokens Meta reports as non-expiring.
 valid_until timestamptz not null check(valid_until>verified_at)
);
create table facebook_messenger_private.events (
 connection_id uuid not null references facebook_messenger_private.connections(id),
 event_ref text not null check(event_ref ~ '^[a-f0-9]{64}$'),
 thread_ref text not null check(thread_ref ~ '^[a-f0-9]{64}$'),
 message_ref text not null check(message_ref ~ '^[a-f0-9]{64}$'),
 kind text not null check(kind in ('inbound','echo','unsupported','deleted')),
 occurred_at timestamptz not null,
 received_at timestamptz not null default clock_timestamp(),
 content_box jsonb not null check(facebook_messenger_private.valid_box(content_box)),
 recipient_box jsonb,
 primary key(connection_id,event_ref),
 unique(connection_id,kind,message_ref),
 check((kind='inbound' and facebook_messenger_private.valid_box(recipient_box)) or (kind<>'inbound' and recipient_box is null))
);
create index fb_messenger_history on facebook_messenger_private.events(connection_id,thread_ref,occurred_at,event_ref);
create table facebook_messenger_private.thread_grants (
 connection_id uuid not null references facebook_messenger_private.connections(id),
 thread_ref text not null check(thread_ref ~ '^[a-f0-9]{64}$'),
 actor_id uuid not null references public.profiles(id),
 expires_at timestamptz not null,
 can_reply boolean not null default false,
 primary key(connection_id,thread_ref,actor_id)
);
create table facebook_messenger_private.actions (
 connection_id uuid not null,
 action_id uuid primary key,
 input_ref text not null,
 actor_id uuid not null references public.profiles(id),
 lease uuid not null,
 generation bigint not null,
 state text not null default 'claimed' check(state in ('claimed','dispatching','accepted','failed','uncertain','blocked')),
 claimed_at timestamptz not null default clock_timestamp(),
 dispatched_at timestamptz,
 finished_at timestamptz,
 dispatch_count integer not null default 0 check(dispatch_count in (0,1)),
 human_paused boolean not null default true check(human_paused),
 text_box jsonb not null check(facebook_messenger_private.valid_box(text_box)),
 http_status integer,
 error_code bigint,
 error_subcode bigint,
 outbound_ref text check(outbound_ref ~ '^[a-f0-9]{64}$'),
 outbound_box jsonb check(outbound_box is null or facebook_messenger_private.valid_box(outbound_box)),
 foreign key(connection_id,input_ref) references facebook_messenger_private.events(connection_id,event_ref),
 unique(connection_id,input_ref),
 check(state <> 'accepted' or (dispatch_count=1 and outbound_ref is not null and outbound_box is not null and http_status between 200 and 299))
);

-- No implicit admin bypass. Server-authenticated actor AND exact, expiring grant.
create function facebook_messenger_private.allowed(c uuid,t text,a uuid,reply boolean) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.profiles p join facebook_messenger_private.thread_grants g on g.actor_id=p.id
 where p.id=a and p.active=true and p.role_id in ('admin','coord_operaciones','gerente_ventas','asesor','juridico')
 and g.connection_id=c and g.thread_ref=t and g.expires_at>now() and (not reply or g.can_reply));
$$;
create function public.fb_messenger_capture_v1(p_connection uuid,p_app text,p_page text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb; n integer:=0; delta integer;
begin
 if not exists(select 1 from facebook_messenger_private.connections where id=p_connection and enabled and app_id=p_app and page_id=p_page)
 or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>100 then raise exception 'capture_denied'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if r->>'connection_id' is distinct from p_connection::text or r->>'provider' is distinct from 'facebook_messenger'
   or r->>'channel' is distinct from 'facebook_dm' then raise exception 'scope_denied'; end if;
  insert into facebook_messenger_private.events(connection_id,event_ref,thread_ref,message_ref,kind,occurred_at,content_box,recipient_box)
  values(p_connection,r->>'event_ref',r->>'thread_ref',r->>'message_ref',r->>'kind',(r->>'occurred_at')::timestamptz,r->'content_box',nullif(r->'recipient_box','null'::jsonb))
  on conflict do nothing;
  get diagnostics delta=row_count; n:=n+delta;
  if delta=0 and not exists(select 1 from facebook_messenger_private.events e where e.connection_id=p_connection
   and e.event_ref=r->>'event_ref' and e.message_ref=r->>'message_ref' and e.thread_ref=r->>'thread_ref'
   and e.kind=r->>'kind' and e.occurred_at=(r->>'occurred_at')::timestamptz) then raise exception 'conflicting_receipt'; end if;
 end loop;
 return jsonb_build_object('received',jsonb_array_length(p_rows),'inserted',n);
end $$;
create function public.fb_messenger_read_v1(p_connection uuid,p_actor uuid,p_input text) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select to_jsonb(e)||jsonb_build_object('provider','facebook_messenger','channel','facebook_dm')
 from facebook_messenger_private.events e join facebook_messenger_private.connections c on c.id=e.connection_id
 where c.enabled and e.connection_id=p_connection and e.event_ref=p_input and e.kind='inbound'
 and facebook_messenger_private.allowed(p_connection,e.thread_ref,p_actor,false)
 and not exists(select 1 from facebook_messenger_private.events d where d.connection_id=e.connection_id and d.message_ref=e.message_ref and d.kind='deleted');
$$;
create function public.fb_messenger_credential_v1(p_connection uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select to_jsonb(k)||jsonb_build_object('app_id',c.app_id,'page_id',c.page_id,
 'valid_until',to_char(k.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
 from facebook_messenger_private.credentials k join facebook_messenger_private.connections c on c.id=k.connection_id
 where c.id=p_connection and c.enabled;
$$;
create function facebook_messenger_private.send_allowed(c uuid,i text,a uuid,g bigint) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from facebook_messenger_private.connections n
 join facebook_messenger_private.events e on e.connection_id=n.id
 join facebook_messenger_private.credentials k on k.connection_id=n.id
 where n.id=c and n.enabled and n.sender_enabled and e.event_ref=i and e.kind='inbound'
 and e.occurred_at<=now() and e.occurred_at>now()-interval '23 hours'
 and k.generation=g and k.valid_until>now()+interval '1 minute' and k.verified_at<=now() and k.verified_at>now()-interval '24 hours'
 and facebook_messenger_private.allowed(c,e.thread_ref,a,true)
 and not exists(select 1 from facebook_messenger_private.events d where d.connection_id=c and d.message_ref=e.message_ref and d.kind='deleted'));
$$;
create function public.fb_messenger_reserve_v1(p_args jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare c uuid:=(p_args->>'connection')::uuid; n integer;
begin
 perform 1 from facebook_messenger_private.connections where id=c for update;
 if not facebook_messenger_private.send_allowed(c,p_args->>'input',(p_args->>'actor')::uuid,(p_args->>'generation')::bigint) then return false; end if;
 insert into facebook_messenger_private.actions(connection_id,action_id,input_ref,actor_id,lease,generation,text_box)
 values(c,(p_args->>'action')::uuid,p_args->>'input',(p_args->>'actor')::uuid,(p_args->>'lease')::uuid,(p_args->>'generation')::bigint,p_args->'text_box')
 on conflict do nothing;
 get diagnostics n=row_count; return n=1;
end $$;
create function public.fb_messenger_start_v1(p_connection uuid,p_action uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare a facebook_messenger_private.actions%rowtype;
begin
 perform 1 from facebook_messenger_private.connections where id=p_connection for update;
 select * into a from facebook_messenger_private.actions where connection_id=p_connection and action_id=p_action and lease=p_lease for update;
 if not found or a.state<>'claimed' then return false; end if;
 if not facebook_messenger_private.send_allowed(p_connection,a.input_ref,a.actor_id,a.generation)
 or a.claimed_at<now()-interval '1 minute' then
  update facebook_messenger_private.actions set state='blocked',finished_at=clock_timestamp() where action_id=p_action; return false;
 end if;
 update facebook_messenger_private.actions set state='dispatching',dispatch_count=1,dispatched_at=clock_timestamp() where action_id=p_action;
 return true;
end $$;
create function public.fb_messenger_finish_v1(p_connection uuid,p_action uuid,p_lease uuid,p_outcome jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare n integer;
begin
 if p_outcome->>'status' is null or p_outcome->>'status' not in ('accepted','failed','uncertain') then return false; end if;
 update facebook_messenger_private.actions set state=p_outcome->>'status',http_status=(p_outcome->>'http_status')::integer,
 error_code=(p_outcome->>'code')::bigint,error_subcode=(p_outcome->>'subcode')::bigint,
 outbound_ref=p_outcome->>'outbound_ref',outbound_box=nullif(p_outcome->'outbound_box','null'::jsonb),finished_at=clock_timestamp()
 where connection_id=p_connection and action_id=p_action and lease=p_lease and state='dispatching' and dispatch_count=1;
 get diagnostics n=row_count; return n=1;
end $$;

alter table facebook_messenger_private.connections enable row level security;
alter table facebook_messenger_private.credentials enable row level security;
alter table facebook_messenger_private.events enable row level security;
alter table facebook_messenger_private.thread_grants enable row level security;
alter table facebook_messenger_private.actions enable row level security;
revoke all on all tables in schema facebook_messenger_private from public,anon,authenticated,service_role;
revoke all on all functions in schema facebook_messenger_private from public,anon,authenticated,service_role;
revoke all on function public.fb_messenger_capture_v1(uuid,text,text,jsonb),public.fb_messenger_read_v1(uuid,uuid,text),
 public.fb_messenger_credential_v1(uuid),public.fb_messenger_reserve_v1(jsonb),public.fb_messenger_start_v1(uuid,uuid,uuid),
 public.fb_messenger_finish_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fb_messenger_capture_v1(uuid,text,text,jsonb),public.fb_messenger_read_v1(uuid,uuid,text),
 public.fb_messenger_credential_v1(uuid),public.fb_messenger_reserve_v1(jsonb),public.fb_messenger_start_v1(uuid,uuid,uuid),
 public.fb_messenger_finish_v1(uuid,uuid,uuid,jsonb) to service_role;
commit;
