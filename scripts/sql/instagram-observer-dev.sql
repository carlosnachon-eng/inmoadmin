-- DEV only. Metadata observer: no business tables, defaults, jobs or triggers touched.
begin;
create schema instagram_observer_private;
revoke all on schema instagram_observer_private from public, anon, authenticated, service_role;
create table instagram_observer_private.receipts (
  receipt_key text primary key check (receipt_key ~ '^[a-f0-9]{64}$'),
  account_id text not null check (account_id = '17841440384433670'),
  received_at timestamptz not null default clock_timestamp()
);
create table instagram_observer_private.events (
  observation_key text primary key check (observation_key ~ '^[a-f0-9]{64}$'),
  receipt_key text not null references instagram_observer_private.receipts,
  kind text not null check (kind in ('dm','dm_echo','comment','mention')),
  native_id text not null check (native_id ~ '^[A-Za-z0-9_.:=-]{1,512}$'),
  subject_ref text check (subject_ref ~ '^[a-f0-9]{64}$'),
  media_id text check (media_id ~ '^[A-Za-z0-9_.:=-]{1,512}$'),
  parent_id text check (parent_id ~ '^[A-Za-z0-9_.:=-]{1,512}$'),
  occurred_at timestamptz,
  received_at timestamptz not null default clock_timestamp(),
  provenance text not null check (provenance in ('unknown','customer_inbound','business_outbound_unattributed')),
  relation_state text not null check (relation_state in ('unresolved','exact_subject')),
  check ((kind in ('dm','dm_echo') and subject_ref is not null and relation_state='exact_subject'
    and provenance = case when kind='dm' then 'customer_inbound' else 'business_outbound_unattributed' end)
    or (kind in ('comment','mention') and relation_state='unresolved' and provenance='unknown'))
);
alter table instagram_observer_private.receipts enable row level security;
alter table instagram_observer_private.events enable row level security;
revoke all on all tables in schema instagram_observer_private from public, anon, authenticated, service_role;
create function public.observe_instagram_dev_v1(p_account_id text, p_receipt_key text, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e jsonb; n integer := 0; affected integer;
begin
  if p_account_id is distinct from '17841440384433670' or p_receipt_key is null
    or p_receipt_key !~ '^[a-f0-9]{64}$' or p_events is null or jsonb_typeof(p_events) <> 'array'
    or jsonb_array_length(p_events) > 100 then raise exception 'instagram_observation_invalid'; end if;
  insert into instagram_observer_private.receipts(receipt_key,account_id)
    values (p_receipt_key,p_account_id) on conflict do nothing;
  for e in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(e) <> 'object' or (e - array['observation_key','kind','native_id','subject_ref',
      'media_id','parent_id','occurred_at','provenance','relation_state']) <> '{}'::jsonb
      then raise exception 'instagram_projection_invalid'; end if;
    insert into instagram_observer_private.events(observation_key,receipt_key,kind,native_id,
      subject_ref,media_id,parent_id,occurred_at,provenance,relation_state)
    values(e->>'observation_key',p_receipt_key,e->>'kind',e->>'native_id',e->>'subject_ref',
      e->>'media_id',e->>'parent_id',(e->>'occurred_at')::timestamptz,e->>'provenance',e->>'relation_state')
    on conflict do nothing;
    get diagnostics affected = row_count; n := n + affected;
  end loop;
  return jsonb_build_object('durable',true,'inserted',n,'duplicates',jsonb_array_length(p_events)-n);
end;
$$;
revoke all on function public.observe_instagram_dev_v1(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.observe_instagram_dev_v1(text,text,jsonb) to service_role;
commit;
