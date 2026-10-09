-- LOCAL REVIEW DRAFT. No remote installation, caller, backfill or grants to service_role.
-- Dedicated private append-only memory; not an authorization/attention/outbound journal.
begin;
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
-- No default privilege changes. No exposed RPC. Future runtime access needs separate review.
commit;
