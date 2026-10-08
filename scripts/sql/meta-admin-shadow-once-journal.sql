-- LOCAL REVIEW DRAFT, NOT a migration, NOT installed in DEV/Production.
-- Installing the journal must be reviewed separately if a future input passes
-- all gates. Existing capture/attention/preflight tables/functions stay intact.
begin;
create table meta_admin_private.shadow_once_runs (
 input_id uuid primary key references meta_admin_private.inbound_inputs(id),
 claim_token uuid not null unique,
 input_fingerprint text not null check(input_fingerprint ~ '^[a-f0-9]{64}$'),
 identity_state text not null check(identity_state in ('matched','unmatched')),
 provider text not null check(provider='openai'),
 model text not null check(model ~ '^gpt-[a-z0-9][a-z0-9.-]*$'),
 status text not null default 'claimed'
   check(status in ('claimed','model_started','complete','blocked','invalidated','uncertain')),
 reason text check(reason ~ '^[a-z0-9_]{1,100}$'),
 model_calls integer not null default 0 check(model_calls between 0 and 1),
 send_calls integer not null default 0 check(send_calls=0),
 run_id text,
 proposed_response text check(length(proposed_response) between 1 and 2000),
 claimed_at timestamptz not null default clock_timestamp(),
 model_started_at timestamptz,
 finished_at timestamptz,
 check((model_calls=0 and status in ('claimed','blocked') and model_started_at is null
          and run_id is null and proposed_response is null)
    or (model_calls=1 and status in ('model_started','complete','invalidated','uncertain') and model_started_at is not null)),
 check(status not in ('complete','invalidated') or (run_id is not null and proposed_response is not null))
);
alter table meta_admin_private.shadow_once_runs enable row level security;
revoke all on meta_admin_private.shadow_once_runs from public,anon,authenticated,service_role;
grant select,insert on meta_admin_private.shadow_once_runs to service_role;
grant update(status,reason,model_calls,run_id,proposed_response,model_started_at,finished_at)
  on meta_admin_private.shadow_once_runs to service_role;
create policy meta_shadow_once_read on meta_admin_private.shadow_once_runs for select to service_role using(true);
create policy meta_shadow_once_insert on meta_admin_private.shadow_once_runs for insert to service_role with check(true);
create policy meta_shadow_once_update on meta_admin_private.shadow_once_runs for update to service_role using(true) with check(true);
-- No delete/reset/reclaim/TTL/retry path. A crashed attempt stays consumed.
commit;
