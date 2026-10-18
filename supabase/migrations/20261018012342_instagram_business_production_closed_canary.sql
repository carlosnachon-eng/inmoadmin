-- Production closed canary. Empty allowlists; no connections or credentials provisioned here.
-- Additive migration, never reads/reinterprets DEV or legacy boxes.
begin;
create schema instagram_business_private;
revoke all on schema instagram_business_private from public,anon,authenticated,service_role;
create table instagram_business_private.connections(
 id uuid primary key,provider text not null default 'instagram_login_business' check(provider='instagram_login_business'),
 app_id text not null check(app_id~'^[0-9]{1,32}$'),instagram_app_id text not null check(instagram_app_id~'^[0-9]{1,32}$'),
 account_id text not null check(account_id~'^[0-9]{1,32}$'),active boolean not null default false,sender_enabled boolean not null default false,
 starts_at timestamptz not null default clock_timestamp(),unique(provider,app_id,instagram_app_id,account_id)
);
create table instagram_business_private.credentials(
 connection_id uuid primary key references instagram_business_private.connections,
 generation uuid unique not null,token_box jsonb not null,scopes text[] not null,
 issued_at timestamptz not null,expires_at timestamptz not null,verified_at timestamptz not null,
 status text not null check(status in ('healthy','reauthorization_required')),token_type text not null check(token_type='bearer'),
 maintenance_lease uuid,maintenance_started_at timestamptz,
 check(expires_at>issued_at),check(token_box->>'provider'='instagram_login_business'),
 check(scopes @> array['instagram_business_basic','instagram_business_manage_messages'] and scopes <@ array['instagram_business_basic','instagram_business_manage_messages'] and cardinality(scopes)=2)
);
create table instagram_business_private.oauth_states(
 state_hash text primary key check(state_hash~'^[a-f0-9]{64}$'),connection_id uuid not null references instagram_business_private.connections,
 actor uuid not null references public.profiles,session_hash text not null check(session_hash~'^[a-f0-9]{64}$'),expires_at timestamptz not null,consumed_at timestamptz
);
create table instagram_business_private.events(
 connection_id uuid not null references instagram_business_private.connections,event_ref text not null check(event_ref~'^[a-f0-9]{64}$'),
 thread_ref text not null check(thread_ref~'^[a-f0-9]{64}$'),subject_ref text not null check(subject_ref~'^[a-f0-9]{64}$'),
 message_ref text not null check(message_ref~'^[a-f0-9]{64}$'),receipt_ref text not null check(receipt_ref~'^[a-f0-9]{64}$'),
 kind text not null check(kind in ('inbound','echo','unsent')),occurred_at timestamptz not null,received_at timestamptz not null default clock_timestamp(),
 content_box jsonb not null,recipient_box jsonb,primary key(connection_id,event_ref),
 check(content_box->>'provider'='instagram_login_business'),check(recipient_box is null or (kind='inbound' and recipient_box->>'provider'='instagram_login_business'))
);
create index business_history on instagram_business_private.events(connection_id,thread_ref,occurred_at);
create index business_message on instagram_business_private.events(connection_id,message_ref,kind);
create table instagram_business_private.actions(
 action uuid primary key,connection_id uuid not null,input text not null,actor uuid not null references public.profiles,
 lease uuid unique not null,credential_generation uuid not null,text_box jsonb not null,
 status text not null default 'reserved' check(status in ('reserved','dispatch_started','accepted','failed','uncertain')),
 reserved_at timestamptz not null default clock_timestamp(),started_at timestamptz,finished_at timestamptz,
 http_status integer,http_error jsonb,outbound_ref text,outbound_box jsonb,
 unique(connection_id,input),foreign key(connection_id,input) references instagram_business_private.events(connection_id,event_ref),
 check(status<>'accepted' or (outbound_ref~'^[a-f0-9]{64}$' and outbound_box is not null))
);
create table instagram_business_private.attention(
 connection_id uuid not null references instagram_business_private.connections,thread_ref text not null,action uuid not null references instagram_business_private.actions,
 paused boolean not null default true check(paused),reason text not null default 'human_manual_reply' check(reason='human_manual_reply'),
 paused_by uuid not null references public.profiles,paused_at timestamptz not null default clock_timestamp(),primary key(connection_id,thread_ref)
);
create table instagram_business_private.canary_operators(
 connection_id uuid not null references instagram_business_private.connections,
 actor uuid not null references public.profiles,active boolean not null default false,
 primary key(connection_id,actor)
);
create table instagram_business_private.canary_threads(
 connection_id uuid not null references instagram_business_private.connections,
 thread_ref text not null check(thread_ref~'^[a-f0-9]{64}$'),active boolean not null default false,
 primary key(connection_id,thread_ref)
);
do $$declare t text;begin foreach t in array array['connections','credentials','oauth_states','events','actions','attention','canary_operators','canary_threads'] loop
 execute format('alter table instagram_business_private.%I enable row level security',t);end loop;end;$$;
revoke all on all tables in schema instagram_business_private from public,anon,authenticated,service_role;
create function instagram_business_private.operator(p_connection uuid,p_actor uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','coord_operaciones'))
 and exists(select 1 from instagram_business_private.canary_operators where connection_id=p_connection and actor=p_actor and active);
$$;
create function public.ig_business_capture_v1(p_connection uuid,p_receipt text,p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c instagram_business_private.connections%rowtype;e jsonb;n integer:=0;k integer;
begin
 select * into c from instagram_business_private.connections where id=p_connection and active;if not found then raise exception 'connection_denied';end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'batch_denied';end if;
 for e in select value from jsonb_array_elements(p_rows) loop
  if e->>'provider' is distinct from 'instagram_login_business' or e->>'connection_id' is distinct from p_connection::text or e->>'thread_type' is distinct from 'instagram_dm'
   or (e->>'occurred_at')::timestamptz<c.starts_at or (e->>'occurred_at')::timestamptz>clock_timestamp()+interval '5 minutes'
   or octet_length((e->'content_box')::text)>140000 then raise exception 'scope_denied';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_connection::text||':'||(e->>'message_ref'),0));
  insert into instagram_business_private.events(connection_id,event_ref,thread_ref,subject_ref,message_ref,receipt_ref,kind,occurred_at,content_box,recipient_box)
  values(p_connection,e->>'event_ref',e->>'thread_ref',e->>'subject_ref',e->>'message_ref',p_receipt,e->>'kind',(e->>'occurred_at')::timestamptz,e->'content_box',nullif(e->'recipient_box','null'::jsonb)) on conflict do nothing;
  get diagnostics k=row_count;n:=n+k;
 end loop;
 return jsonb_build_object('durable',true,'inserted',n,'duplicates',jsonb_array_length(p_rows)-n);
end;$$;
create function public.ig_business_input_v1(p_connection uuid,p_input text,p_actor uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(e)||jsonb_build_object('provider',c.provider,'thread_type','instagram_dm','deleted',false,'ambiguous',false)
 from instagram_business_private.events e join instagram_business_private.connections c on c.id=e.connection_id
 where e.connection_id=p_connection and e.event_ref=p_input and c.active and instagram_business_private.operator(p_connection,p_actor)
 and exists(select 1 from instagram_business_private.canary_threads t where t.connection_id=e.connection_id and t.thread_ref=e.thread_ref and t.active)
 and e.kind='inbound' and e.recipient_box is not null and e.occurred_at<=clock_timestamp() and e.occurred_at>clock_timestamp()-interval '23 hours'
 and (select count(*) from instagram_business_private.events x where x.connection_id=e.connection_id and x.message_ref=e.message_ref)=1;
$$;
create function public.ig_business_reserve_v1(p_args jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare e jsonb;n integer;cid uuid:=(p_args->>'connection_id')::uuid;
begin
 e:=public.ig_business_input_v1(cid,p_args->>'input',(p_args->>'actor')::uuid);if e is null then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(cid::text||':'||(e->>'message_ref'),0));
 e:=public.ig_business_input_v1(cid,p_args->>'input',(p_args->>'actor')::uuid);if e is null then return false;end if;
 if not exists(select 1 from instagram_business_private.connections where id=cid and active and sender_enabled) then return false;end if;
 insert into instagram_business_private.actions(action,connection_id,input,actor,lease,credential_generation,text_box)
 values((p_args->>'action')::uuid,cid,p_args->>'input',(p_args->>'actor')::uuid,(p_args->>'lease')::uuid,(p_args->>'credential_generation')::uuid,p_args->'text_box') on conflict do nothing;
 get diagnostics n=row_count;if n<>1 then return false;end if;
 insert into instagram_business_private.attention(connection_id,thread_ref,action,paused_by)
 values(cid,e->>'thread_ref',(p_args->>'action')::uuid,(p_args->>'actor')::uuid) on conflict do nothing;
 return true;
end;$$;
create function public.ig_business_start_v1(p_action uuid,p_lease uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare a instagram_business_private.actions%rowtype;e jsonb;n integer;
begin
 select * into a from instagram_business_private.actions where action=p_action and lease=p_lease for update;
 if not found or a.status<>'reserved' or a.reserved_at<clock_timestamp()-interval '30 seconds' then return false;end if;
 e:=public.ig_business_input_v1(a.connection_id,a.input,a.actor);if e is null then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(a.connection_id::text||':'||(e->>'message_ref'),0));
 if public.ig_business_input_v1(a.connection_id,a.input,a.actor) is null then return false;end if;
 if not exists(select 1 from instagram_business_private.connections c join instagram_business_private.credentials t on t.connection_id=c.id
  where c.id=a.connection_id and c.active and c.sender_enabled and t.generation=a.credential_generation and t.status='healthy'
  and t.expires_at>clock_timestamp()+interval '1 minute' and t.verified_at>clock_timestamp()-interval '24 hours'
  and t.maintenance_lease is null) or not exists(select 1 from instagram_business_private.attention where connection_id=a.connection_id and thread_ref=e->>'thread_ref' and paused) then return false;end if;
 update instagram_business_private.actions set status='dispatch_started',started_at=clock_timestamp() where action=p_action and status='reserved';
 get diagnostics n=row_count;return n=1;
end;$$;
create function public.ig_business_finish_v1(p_action uuid,p_lease uuid,p_outcome jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if coalesce(p_outcome->>'status','') not in ('accepted','failed','uncertain') or
 (p_outcome-array['status','http_status','http_error','outbound_ref','outbound_box'])<>'{}'::jsonb then return false;end if;
 update instagram_business_private.actions set status=p_outcome->>'status',finished_at=clock_timestamp(),http_status=(p_outcome->>'http_status')::integer,
 http_error=nullif(p_outcome->'http_error','null'::jsonb),outbound_ref=p_outcome->>'outbound_ref',outbound_box=nullif(p_outcome->'outbound_box','null'::jsonb)
 where action=p_action and lease=p_lease and status='dispatch_started';get diagnostics n=row_count;return n=1;
end;$$;
create function public.ig_business_history_v1(p_connection uuid,p_thread text,p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not instagram_business_private.operator(p_connection,p_actor) or not exists(select 1 from instagram_business_private.connections where id=p_connection and active) or not exists(select 1 from instagram_business_private.canary_threads where connection_id=p_connection and thread_ref=p_thread and active) then return null;end if;
 return jsonb_build_object('rows',(select coalesce(jsonb_agg(x order by x.occurred_at),'[]'::jsonb) from (
 select e.*, 'instagram_login_business'::text as provider,'instagram_dm'::text as thread_type,
 exists(select 1 from instagram_business_private.attention t where t.connection_id=p_connection and t.thread_ref=p_thread and paused) as paused,
 exists(select 1 from instagram_business_private.actions a where a.connection_id=e.connection_id and a.outbound_ref=e.message_ref and a.status='accepted') as manual_confirmed,
 (select a.status from instagram_business_private.actions a where a.connection_id=e.connection_id and a.input=e.event_ref) as status
 from instagram_business_private.events e where e.connection_id=p_connection and e.thread_ref=p_thread order by e.occurred_at desc limit 100) x),
 'tombstones',(select coalesce(jsonb_agg(message_ref),'[]'::jsonb) from instagram_business_private.events where connection_id=p_connection and thread_ref=p_thread and kind='unsent'));
end;$$;
create function public.ig_business_threads_v1(p_connection uuid,p_actor uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x order by x.last_activity desc),'[]'::jsonb) from (
 select e.thread_ref,max(e.occurred_at) as last_activity,'instagram_login_business'::text as provider,'instagram_dm'::text as thread_type
 from instagram_business_private.events e join instagram_business_private.connections c on c.id=e.connection_id
 where e.connection_id=p_connection and c.active and instagram_business_private.operator(p_connection,p_actor) and exists(select 1 from instagram_business_private.canary_threads t where t.connection_id=e.connection_id and t.thread_ref=e.thread_ref and t.active) group by e.thread_ref order by max(e.occurred_at) desc limit 100) x;
$$;
-- Credential/state endpoints are exclusively service-role, never browser APIs.
create function public.ig_business_token_v1(p_connection uuid,p_op text,p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c instagram_business_private.connections%rowtype;r instagram_business_private.credentials%rowtype;n integer;
begin
 select * into c from instagram_business_private.connections where id=p_connection and active;if not found then raise exception 'connection_denied';end if;
 if p_op='load' then
  select * into r from instagram_business_private.credentials where connection_id=p_connection;
  if not found then return null;end if;
  return to_jsonb(r)||jsonb_build_object('provider',c.provider,'app_id',c.app_id,'instagram_app_id',c.instagram_app_id,'account_id',c.account_id);
 elsif p_op='state_create' then
  if not instagram_business_private.operator(p_connection,(p_data->>'actor')::uuid) or (p_data->>'expires_at')::timestamptz>clock_timestamp()+interval '11 minutes' then raise exception 'state_denied';end if;
  insert into instagram_business_private.oauth_states(state_hash,connection_id,actor,session_hash,expires_at) values(p_data->>'state_hash',p_connection,(p_data->>'actor')::uuid,p_data->>'session_hash',(p_data->>'expires_at')::timestamptz);
  return 'true'::jsonb;
 elsif p_op='state_consume' then
  update instagram_business_private.oauth_states set consumed_at=clock_timestamp() where state_hash=p_data->>'state_hash' and connection_id=p_connection
  and actor=(p_data->>'actor')::uuid and session_hash=p_data->>'session_hash' and consumed_at is null and expires_at>clock_timestamp() and instagram_business_private.operator(p_connection,actor);
  get diagnostics n=row_count;return to_jsonb(n=1);
 elsif p_op='save' then
  if p_data->>'provider' is distinct from c.provider or p_data->>'app_id' is distinct from c.app_id or p_data->>'instagram_app_id' is distinct from c.instagram_app_id or p_data->>'account_id' is distinct from c.account_id then raise exception 'token_scope_denied';end if;
  insert into instagram_business_private.credentials(connection_id,generation,token_box,scopes,issued_at,expires_at,verified_at,status,token_type)
  values(p_connection,(p_data->>'generation')::uuid,p_data->'token_box',array(select jsonb_array_elements_text(p_data->'scopes')),(p_data->>'issued_at')::timestamptz,(p_data->>'expires_at')::timestamptz,(p_data->>'verified_at')::timestamptz,'healthy','bearer')
  on conflict(connection_id) do update set generation=excluded.generation,token_box=excluded.token_box,scopes=excluded.scopes,issued_at=excluded.issued_at,expires_at=excluded.expires_at,verified_at=excluded.verified_at,status='healthy',maintenance_lease=null,maintenance_started_at=null;
  return 'true'::jsonb;
 elsif p_op='claim' then
  update instagram_business_private.credentials set maintenance_lease=(p_data->>'lease')::uuid,maintenance_started_at=clock_timestamp()
  where connection_id=p_connection and generation=(p_data->>'generation')::uuid and maintenance_lease is null and status='healthy' and expires_at>clock_timestamp();
  get diagnostics n=row_count;return to_jsonb(n=1);
 elsif p_op='finish' then
  update instagram_business_private.credentials set generation=(p_data->'next'->>'generation')::uuid,token_box=p_data->'next'->'token_box',issued_at=(p_data->'next'->>'issued_at')::timestamptz,
  expires_at=(p_data->'next'->>'expires_at')::timestamptz,verified_at=(p_data->'next'->>'verified_at')::timestamptz,status='healthy',maintenance_lease=null,maintenance_started_at=null
  where connection_id=p_connection and generation=(p_data->>'generation')::uuid and maintenance_lease=(p_data->>'lease')::uuid;
  get diagnostics n=row_count;return to_jsonb(n=1);
 elsif p_op='fail' then
  update instagram_business_private.credentials set status='reauthorization_required' where connection_id=p_connection and generation=(p_data->>'generation')::uuid and maintenance_lease=(p_data->>'lease')::uuid;
  get diagnostics n=row_count;return to_jsonb(n=1);
 end if;raise exception 'operation_denied';
end;$$;
revoke all on all functions in schema instagram_business_private from public,anon,authenticated,service_role;
revoke all on function public.ig_business_capture_v1(uuid,text,jsonb),public.ig_business_input_v1(uuid,text,uuid),public.ig_business_reserve_v1(jsonb),public.ig_business_start_v1(uuid,uuid),public.ig_business_finish_v1(uuid,uuid,jsonb),public.ig_business_history_v1(uuid,text,uuid),public.ig_business_threads_v1(uuid,uuid),public.ig_business_token_v1(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ig_business_capture_v1(uuid,text,jsonb),public.ig_business_input_v1(uuid,text,uuid),public.ig_business_reserve_v1(jsonb),public.ig_business_start_v1(uuid,uuid),public.ig_business_finish_v1(uuid,uuid,jsonb),public.ig_business_history_v1(uuid,text,uuid),public.ig_business_threads_v1(uuid,uuid),public.ig_business_token_v1(uuid,text,jsonb) to service_role;
create function public.ig_business_operator_v1(p_connection uuid,p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select instagram_business_private.operator(p_connection,p_actor);
$$;
revoke all on function public.ig_business_operator_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.ig_business_operator_v1(uuid,uuid) to service_role;
commit;
