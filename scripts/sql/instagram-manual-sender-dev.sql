-- DEV ONLY: not a Production migration. Apply only to hjfwjnejbcpmknvfpdcq.
begin;
create schema instagram_manual_private;
revoke all on schema instagram_manual_private from public,anon,authenticated,service_role;
create table instagram_manual_private.targets (
 input text primary key references instagram_observer_private.events(observation_key),
 box jsonb not null check(jsonb_typeof(box)='object' and box ?& array['v','key_tag','iv','tag','ciphertext'] and (box-array['v','key_tag','iv','tag','ciphertext'])='{}'::jsonb
   and box->>'v'='1' and box->>'key_tag' ~ '^[a-f0-9]{16}$' and box->>'iv' ~ '^[a-f0-9]{24}$'
   and box->>'tag' ~ '^[a-f0-9]{32}$' and box->>'ciphertext' ~ '^([a-f0-9]{2}){1,32}$'),
 captured_at timestamptz not null default clock_timestamp()
);
create table instagram_manual_private.actions (
 action uuid primary key, input text not null unique references instagram_manual_private.targets,
 actor uuid not null references public.profiles(id),lease uuid not null unique,
 text text not null check(length(text)>0 and length(text)<1000 and octet_length(text)<=1000 and text=btrim(text)
   and text !~ '[<>]' and text !~ '[[:cntrl:]]'),
 created_at timestamptz not null default clock_timestamp()
);
create table instagram_manual_private.attention (
 action uuid primary key references instagram_manual_private.actions,
 account_id text not null check(account_id='17841440384433670'),
 subject_ref text not null check(subject_ref ~ '^[a-f0-9]{64}$'),
 paused boolean not null default true check(paused), reason text not null default 'human_manual_reply' check(reason='human_manual_reply'),
 paused_by uuid not null references public.profiles(id),paused_at timestamptz not null default clock_timestamp()
);
create table instagram_manual_private.events (
 action uuid not null references instagram_manual_private.actions,
 phase text not null check(phase in ('dispatch_started','outcome')),
 status text check(status in ('accepted','failed','uncertain')),message_id text unique,
 http_error jsonb,created_at timestamptz not null default clock_timestamp(),primary key(action,phase),
 check((phase='dispatch_started' and status is null and message_id is null and http_error is null)
   or (phase='outcome' and status is not null and ((status='accepted' and message_id is not null and length(message_id) between 1 and 512 and message_id ~ '^[A-Za-z0-9_.:=-]+$' and http_error is null)
     or (status in ('failed','uncertain') and message_id is null))))
);
create function instagram_manual_private.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'instagram_manual_append_only';end;$$;
do $$declare t text;begin
 foreach t in array array['targets','actions','attention','events'] loop
  execute format('alter table instagram_manual_private.%I enable row level security',t);
  execute format('create trigger immutable before update or delete on instagram_manual_private.%I for each row execute function instagram_manual_private.immutable()',t);
 end loop;
end;$$;
revoke all on all tables in schema instagram_manual_private from public,anon,authenticated,service_role;
revoke all on all functions in schema instagram_manual_private from public,anon,authenticated,service_role;

-- New signed receipts only; metadata + encrypted target in ONE transaction.
-- Existing metadata-only events cannot be retrofitted, even by replaying a receipt.
create function public.observe_instagram_manual_dev_v1(p_account_id text,p_receipt_key text,p_events jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e jsonb; clean jsonb; result jsonb; fresh text[];
begin
 if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>100 then raise exception 'invalid_projection';end if;
 perform pg_advisory_xact_lock(hashtextextended('ig-capture:'||p_receipt_key,0));
 select array_agg(value->>'observation_key') into fresh from jsonb_array_elements(p_events)
  where not exists(select 1 from instagram_observer_private.events where observation_key=value->>'observation_key');
 select coalesce(jsonb_agg(value-'recipient_ciphertext'),'[]'::jsonb) into clean from jsonb_array_elements(p_events);
 result:=public.observe_instagram_dev_v1(p_account_id,p_receipt_key,clean);
 for e in select value from jsonb_array_elements(p_events) loop
  if e ? 'recipient_ciphertext' then
   if e->>'kind' is distinct from 'dm' or e->>'provenance' is distinct from 'customer_inbound'
     or e->>'relation_state' is distinct from 'exact_subject' then raise exception 'invalid_target';end if;
   if e->>'observation_key'=any(fresh) then
    insert into instagram_manual_private.targets(input,box) values(e->>'observation_key',e->'recipient_ciphertext') on conflict do nothing;
   end if;
  end if;
 end loop;
 return result;
end;$$;

create function public.instagram_manual_load_dev_v1(p_input text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','coord_operaciones')) then return null;end if;
 select to_jsonb(e)||jsonb_build_object('recipient_ciphertext',t.box,'account_id',r.account_id,'page_id','119960324707764') into result
 from instagram_observer_private.events e join instagram_observer_private.receipts r using(receipt_key)
 join instagram_manual_private.targets t on t.input=e.observation_key
 where e.observation_key=p_input and r.account_id='17841440384433670' and e.kind='dm'
 and e.provenance='customer_inbound' and e.relation_state='exact_subject'
 and e.occurred_at<=clock_timestamp() and e.occurred_at>clock_timestamp()-interval '24 hours'
 -- Different observations of the same native message are not silently ignored.
 and (select count(*) from instagram_observer_private.events other where other.native_id=e.native_id)=1;
 return result;
end;$$;

create function public.instagram_manual_reserve_dev_v1(p_input text,p_actor uuid,p_action uuid,p_lease uuid,p_text text)
returns boolean language plpgsql security definer set search_path='' as $$
declare e jsonb; n integer;
begin
 e:=public.instagram_manual_load_dev_v1(p_input,p_actor);if e is null then return false;end if;
 insert into instagram_manual_private.actions(action,input,actor,lease,text) values(p_action,p_input,p_actor,p_lease,p_text) on conflict do nothing;
 get diagnostics n=row_count;if n<>1 then return false;end if;
 insert into instagram_manual_private.attention(action,account_id,subject_ref,paused_by)
 values(p_action,e->>'account_id',e->>'subject_ref',p_actor);
 return true;
end;$$;

create function public.instagram_manual_start_dev_v1(p_action uuid,p_lease uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare a instagram_manual_private.actions%rowtype; n integer;
begin
 select * into a from instagram_manual_private.actions where action=p_action and lease=p_lease;
 if not found or public.instagram_manual_load_dev_v1(a.input,a.actor) is null
  or a.created_at<clock_timestamp()-interval '30 seconds'
  or not exists(select 1 from instagram_manual_private.attention where action=p_action and paused)
  then return false;end if;
 insert into instagram_manual_private.events(action,phase) values(p_action,'dispatch_started') on conflict do nothing;
 get diagnostics n=row_count;return n=1;
end;$$;

create function public.instagram_manual_finish_dev_v1(p_action uuid,p_lease uuid,p_status text,p_message_id text,p_http_error jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_status is null or p_status not in ('accepted','failed','uncertain') then return false;end if;
 if p_http_error is not null and (jsonb_typeof(p_http_error)<>'object'
  or (p_http_error-array['http_status','code','subcode','type','message','details'])<>'{}'::jsonb
  or length(p_http_error::text)>3000) then return false;end if;
 if not exists(select 1 from instagram_manual_private.actions where action=p_action and lease=p_lease)
 or not exists(select 1 from instagram_manual_private.events where action=p_action and phase='dispatch_started') then return false;end if;
 insert into instagram_manual_private.events(action,phase,status,message_id,http_error)
 values(p_action,'outcome',p_status,p_message_id,p_http_error) on conflict do nothing;
 get diagnostics n=row_count;return n=1;
end;$$;

create function public.instagram_manual_status_dev_v1(p_input text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a instagram_manual_private.actions%rowtype; result jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','coord_operaciones')) then return null;end if;
 select * into a from instagram_manual_private.actions where input=p_input;
 if not found then return jsonb_build_object('status','not_consumed');end if;
 select jsonb_build_object('status',coalesce(e.status,'uncertain'),'paused',true,
  'delivery_status',case when e.status='accepted' and exists(
   select 1 from instagram_observer_private.events echo
   join instagram_observer_private.receipts r on r.receipt_key=echo.receipt_key
   join instagram_manual_private.attention att on att.action=a.action
   where echo.native_id=e.message_id and echo.kind='dm_echo' and echo.relation_state='exact_subject'
    and echo.provenance='business_outbound_unattributed' and echo.subject_ref=att.subject_ref and r.account_id=att.account_id
   ) then 'sent' else null end,
  'delivered_supported',false,'read_supported',false)
 into result from (select 1) singleton left join instagram_manual_private.events e on e.action=a.action and e.phase='outcome';
 return result;
end;$$;

create function public.instagram_manual_attention_dev_v1(p_input text)
returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from instagram_observer_private.events e
 join instagram_observer_private.receipts r using(receipt_key)
 join instagram_manual_private.attention a on a.account_id=r.account_id and a.subject_ref=e.subject_ref
 where e.observation_key=p_input and e.kind in ('dm','dm_echo') and a.paused);
$$;

revoke all on function public.observe_instagram_manual_dev_v1(text,text,jsonb),
 public.instagram_manual_load_dev_v1(text,uuid),public.instagram_manual_reserve_dev_v1(text,uuid,uuid,uuid,text),
 public.instagram_manual_start_dev_v1(uuid,uuid),public.instagram_manual_finish_dev_v1(uuid,uuid,text,text,jsonb),
 public.instagram_manual_status_dev_v1(text,uuid),public.instagram_manual_attention_dev_v1(text)
 from public,anon,authenticated;
grant execute on function public.observe_instagram_manual_dev_v1(text,text,jsonb),
 public.instagram_manual_load_dev_v1(text,uuid),public.instagram_manual_reserve_dev_v1(text,uuid,uuid,uuid,text),
 public.instagram_manual_start_dev_v1(uuid,uuid),public.instagram_manual_finish_dev_v1(uuid,uuid,text,text,jsonb),
 public.instagram_manual_status_dev_v1(text,uuid),public.instagram_manual_attention_dev_v1(text)
 to service_role;
commit;
