-- Conversation memory capabilities; no production caller or business effects.
begin;
-- Dedicated private append-only memory; not an authorization/attention/outbound journal.
create schema if not exists meta_admin_memory_private;
revoke all on schema meta_admin_memory_private from public,anon,authenticated,service_role;
create table meta_admin_memory_private.episodes (
 id text primary key check(id ~ '^episode_[a-f0-9]{32}$'),
 subject text not null check(subject ~ '^subject_[a-f0-9]{64}$'),
 identity_fingerprint text check(identity_fingerprint ~ '^[a-f0-9]{64}$'),
 scope jsonb not null check(jsonb_typeof(scope)='object'),
 family text not null check(family in ('agreement','payments','maintenance','clarification')),
 topic text not null check(topic in ('agreement','payments','maintenance','clarification','maintenance_water','maintenance_gas','maintenance_electricity')),
 created_at timestamptz not null default clock_timestamp(),
 check(identity_fingerprint is not null or scope='{}'::jsonb)
);
create index memory_subject on meta_admin_memory_private.episodes(subject,id);
create table meta_admin_memory_private.revisions (
 episode_id text not null references meta_admin_memory_private.episodes(id),
 version integer not null check(version>0),
 source_ref text not null check(source_ref ~ '^message_[a-f0-9]{16,64}$'),
 status text not null check(status in ('open','waiting','contradicted','resolved')),
 pending text not null check(pending in ('none','clarification','verification','document','visit','human_review')),
 commitment text not null check(commitment in ('none','will_check','will_report','will_confirm','will_send')),
 contradiction boolean not null,
 source_refs jsonb not null check(jsonb_typeof(source_refs)='array' and jsonb_array_length(source_refs) between 1 and 500),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(episode_id,version), unique(episode_id,source_ref),
 check(source_refs @> jsonb_build_array(source_ref)),
 check(not contradiction or status='contradicted')
);
alter table meta_admin_memory_private.episodes enable row level security;
alter table meta_admin_memory_private.revisions enable row level security;
revoke all on meta_admin_memory_private.episodes,meta_admin_memory_private.revisions from public,anon,authenticated,service_role;
create function meta_admin_memory_private.immutable_memory() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'memory_append_only'; end $$;
revoke all on function meta_admin_memory_private.immutable_memory() from public,anon,authenticated,service_role;
create trigger immutable_episode before update or delete on meta_admin_memory_private.episodes
 for each row execute function meta_admin_memory_private.immutable_memory();
create trigger immutable_revision before update or delete on meta_admin_memory_private.revisions
 for each row execute function meta_admin_memory_private.immutable_memory();
-- Additive capability surface. Install after meta-admin-conversation-memory.sql.
-- No business/source writes; no caller. Service role receives EXECUTE, not table access.
create function public.meta_admin_memory_read_v1(p_subject text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_subject is null or p_subject !~ '^subject_[a-f0-9]{64}$' then raise exception 'memory_subject_invalid'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) into result from (
  select e.id,e.subject,e.identity_fingerprint as "identityFingerprint",e.scope,e.family,e.topic,
   r.version,r.status,r.pending,r.commitment,r.contradiction,r.source_refs as "sourceRefs"
  from meta_admin_memory_private.episodes e join lateral (
   select * from meta_admin_memory_private.revisions where episode_id=e.id order by version desc limit 1
  ) r on true where e.subject=p_subject order by e.id limit 101
 ) x;
 if jsonb_array_length(result)>100 then raise exception 'episode_limit'; end if;
 return result;
end $$;

create function public.meta_admin_memory_append_v1(p_episode jsonb,p_expected_version integer,p_source_ref text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare root meta_admin_memory_private.episodes; last_row meta_admin_memory_private.revisions;
 prior meta_admin_memory_private.revisions; v integer; subject_key text;
begin
 if p_episode is null or jsonb_typeof(p_episode)<>'object' or p_expected_version is null
  or p_expected_version<0 or p_source_ref is null or p_source_ref !~ '^message_[a-f0-9]{16,64}$'
  or not (p_episode ?& array['id','subject','identityFingerprint','scope','family','topic','version','status','pending','commitment','contradiction','sourceRefs'])
  or exists(select 1 from jsonb_object_keys(p_episode) k where k<>all(array['id','subject','identityFingerprint','scope','family','topic','version','status','pending','commitment','contradiction','sourceRefs','updatedAt']))
 then raise exception 'memory_input_invalid'; end if;
 subject_key:=p_episode->>'subject'; v:=(p_episode->>'version')::integer;
 if subject_key is null or subject_key !~ '^subject_[a-f0-9]{64}$'
  or v is null or v<>p_expected_version+1 then raise exception 'memory_version_invalid'; end if;
 if jsonb_typeof(p_episode->'sourceRefs')<>'array' or jsonb_array_length(p_episode->'sourceRefs') not between 1 and 500
  or exists(select 1 from jsonb_array_elements(p_episode->'sourceRefs') r where jsonb_typeof(r)<>'string' or (r#>>'{}') !~ '^message_[a-f0-9]{16,64}$')
  or not (p_episode->'sourceRefs' @> jsonb_build_array(p_source_ref)) then raise exception 'memory_sources_invalid'; end if;
 if jsonb_typeof(p_episode->'scope')<>'object' or exists(select 1 from jsonb_each(p_episode->'scope') kv
  where kv.key<>all(array['property_ref','unit_ref','contract_ref','period','ticket_ref'])
   or jsonb_typeof(kv.value)<>'string'
   or (kv.key='period' and kv.value#>>'{}' !~ '^\d{4}-(0[1-9]|1[0-2])$')
   or (kv.key<>'period' and kv.value#>>'{}' !~ ('^'||replace(kv.key,'_ref','')||'_[a-f0-9]{16,64}$')))
 then raise exception 'memory_scope_invalid'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(subject_key,0));
 select * into root from meta_admin_memory_private.episodes where id=p_episode->>'id';
 if found and (root.subject is distinct from subject_key
  or root.identity_fingerprint is distinct from p_episode->>'identityFingerprint'
  or root.scope is distinct from p_episode->'scope' or root.family is distinct from p_episode->>'family'
  or root.topic is distinct from p_episode->>'topic') then raise exception 'memory_scope_immutable'; end if;
 select * into prior from meta_admin_memory_private.revisions where episode_id=p_episode->>'id' and source_ref=p_source_ref;
 if found then
  if prior.version<>v or prior.status is distinct from p_episode->>'status' or prior.pending is distinct from p_episode->>'pending'
   or prior.commitment is distinct from p_episode->>'commitment' or prior.contradiction is distinct from (p_episode->>'contradiction')::boolean
   or prior.source_refs is distinct from p_episode->'sourceRefs' then raise exception 'memory_replay_conflict'; end if;
  return jsonb_build_object('status','duplicate','version',prior.version);
 end if;
 select * into last_row from meta_admin_memory_private.revisions where episode_id=p_episode->>'id' order by version desc limit 1;
 if coalesce(last_row.version,0)<>p_expected_version or last_row.status='resolved' then raise exception 'memory_stale'; end if;
 if last_row.version is not null and (not (p_episode->'sourceRefs' @> last_row.source_refs)
  or (last_row.contradiction and (p_episode->>'contradiction')::boolean is distinct from true)) then raise exception 'memory_evidence_loss'; end if;
 if root.id is null then
  insert into meta_admin_memory_private.episodes(id,subject,identity_fingerprint,scope,family,topic)
  values(p_episode->>'id',subject_key,p_episode->>'identityFingerprint',p_episode->'scope',p_episode->>'family',p_episode->>'topic');
 end if;
 insert into meta_admin_memory_private.revisions(episode_id,version,source_ref,status,pending,commitment,contradiction,source_refs)
 values(p_episode->>'id',v,p_source_ref,p_episode->>'status',p_episode->>'pending',p_episode->>'commitment',(p_episode->>'contradiction')::boolean,p_episode->'sourceRefs');
 return jsonb_build_object('status','appended','version',v);
end $$;

-- Native provenance is necessary, NOT sufficient for audience or private-history grants.
-- Existing source schemas have no reviewed per-message audience/data-scope evidence.
-- Return explicit unknown rather than substitute a client role, phone match or app echo.
create function public.meta_admin_memory_evidence_v1(p_input_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('input_id',i.id,'checked_at',statement_timestamp(),
  'subject_ref',se.subject_ref,'key_tag',se.key_tag,
  'native_verified',se.evidence_state='exact' and se.evidence_source='signed_from'
    and se.subject_ref=i.sender_ref and se.key_tag ~ '^[a-f0-9]{64}$' and se.subject_ref ~ '^[a-f0-9]{64}$'
    and i.sender_evidence in ('signed_from','signed_from_and_wa_id') and m.category='inbound' and m.event_type='message.received'
    and m.state='observed' and m.observer_only and m.native_message_id=i.native_message_id
    and m.waba_id=i.waba_id and m.phone_number_id=i.phone_number_id and i.capture_reason='captured',
  'scope_verified',i.waba_id='1297760461811288' and i.phone_number_id='1198305790026665'
    and s.respond_channel_id='544519' and s.enabled,
  'audience','unknown','audience_reason','no_durable_message_audience_source',
  'history_authorized',false,'history_reason','no_durable_message_scope_source',
  'human_authorized',false)
 from meta_admin_private.inbound_inputs i
 join public.meta_observer_events m on m.id=i.meta_observer_event_id
 left join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 left join public.meta_observer_admin_scope s on s.waba_id=i.waba_id and s.phone_number_id=i.phone_number_id
 where i.id=p_input_id and i.waba_id='1297760461811288' and i.phone_number_id='1198305790026665'
$$;
revoke all on function public.meta_admin_memory_read_v1(text) from public,anon,authenticated,service_role;
revoke all on function public.meta_admin_memory_append_v1(jsonb,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.meta_admin_memory_evidence_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_memory_read_v1(text) to service_role;
grant execute on function public.meta_admin_memory_append_v1(jsonb,integer,text) to service_role;
grant execute on function public.meta_admin_memory_evidence_v1(uuid) to service_role;
commit;
