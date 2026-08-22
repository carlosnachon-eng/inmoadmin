-- DEV-only equivalent of the Production migration. No seed and no Claude call.
begin;
do $$ begin
  if current_setting('app.settings.environment', true) is distinct from 'dev' then raise exception 'DEV only'; end if;
  if to_regclass('public.shadow_messages') is null or to_regclass('public.shadow_ai_runs') is null then raise exception 'P3 DEV missing'; end if;
  if to_regclass('public.shadow_ai_manual_authorizations') is not null then raise exception 'Already installed; stop and audit'; end if;
end $$;

create table public.shadow_ai_manual_authorizations (
  authorization_id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.shadow_messages(id) on delete restrict,
  authorized_by uuid not null references public.profiles(id) on delete restrict,
  authorized_at timestamptz not null default now(), expires_at timestamptz not null,
  consumed_at timestamptz, revoked_at timestamptz,
  purpose text not null default 'real_shadow_manual' check (purpose='real_shadow_manual'),
  model text not null check(char_length(model) between 1 and 120),
  prompt_version text not null check(char_length(prompt_version) between 1 and 160),
  ai_run_id uuid references public.shadow_ai_runs(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint shadow_ai_manual_authorizations_ttl_check check(expires_at>authorized_at and expires_at<=authorized_at+interval '15 minutes'),
  constraint shadow_ai_manual_authorizations_state_check check(not(consumed_at is not null and revoked_at is not null) and (consumed_at is null or consumed_at>=authorized_at) and (revoked_at is null or revoked_at>=authorized_at) and ((consumed_at is null and ai_run_id is null) or (consumed_at is not null and ai_run_id is not null)))
);
create index shadow_ai_manual_authorizations_message_created_idx on public.shadow_ai_manual_authorizations(message_id,model,prompt_version,created_at desc);
create unique index shadow_ai_manual_authorizations_run_uidx on public.shadow_ai_manual_authorizations(ai_run_id) where ai_run_id is not null;
comment on table public.shadow_ai_manual_authorizations is 'dev-bootstrap:202608220001:p3-real-shadow-single-use-authorizations; no PII';
alter table public.shadow_ai_manual_authorizations enable row level security;
revoke all on public.shadow_ai_manual_authorizations from public,anon,authenticated;
grant all on public.shadow_ai_manual_authorizations to service_role;
grant select on public.shadow_ai_manual_authorizations to authenticated;
create policy shadow_ai_manual_authorizations_authorized_select on public.shadow_ai_manual_authorizations for select to authenticated using(public.shadow_authorized_role());

create function public.authorize_shadow_ai_manual_message(p_message_id uuid,p_authorized_by uuid,p_model text,p_prompt_version text,p_ttl_seconds integer default 600)
returns public.shadow_ai_manual_authorizations language plpgsql security definer set search_path=public,pg_temp as $$
declare created public.shadow_ai_manual_authorizations;
begin
 if p_ttl_seconds<60 or p_ttl_seconds>900 then raise exception 'manual_authorization_invalid_ttl'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_message_id::text||':'||p_model||':'||p_prompt_version,0));
 if exists(select 1 from public.shadow_ai_manual_authorizations where message_id=p_message_id and model=p_model and prompt_version=p_prompt_version and consumed_at is null and revoked_at is null and expires_at>clock_timestamp()) then raise exception 'manual_authorization_already_active'; end if;
 insert into public.shadow_ai_manual_authorizations(message_id,authorized_by,expires_at,model,prompt_version) values(p_message_id,p_authorized_by,clock_timestamp()+make_interval(secs=>p_ttl_seconds),p_model,p_prompt_version) returning * into created;
 return created;
end $$;
create function public.consume_shadow_ai_manual_authorization(p_authorization_id uuid,p_message_id uuid,p_ai_run_id uuid,p_model text,p_prompt_version text)
returns public.shadow_ai_manual_authorizations language plpgsql security definer set search_path=public,pg_temp as $$
declare consumed public.shadow_ai_manual_authorizations;
begin
 update public.shadow_ai_manual_authorizations a set consumed_at=clock_timestamp(),ai_run_id=p_ai_run_id where a.authorization_id=p_authorization_id and a.message_id=p_message_id and a.model=p_model and a.prompt_version=p_prompt_version and a.consumed_at is null and a.revoked_at is null and a.expires_at>clock_timestamp() and exists(select 1 from public.shadow_ai_runs r where r.id=p_ai_run_id and r.message_id=p_message_id and r.model=p_model and r.prompt_version=p_prompt_version and r.status='running' and r.input_kind='conversational_message' and r.operational_event_id is null) returning a.* into consumed;
 if consumed.authorization_id is null then raise exception 'manual_authorization_not_consumable'; end if;
 return consumed;
end $$;
create function public.revoke_shadow_ai_manual_authorization(p_authorization_id uuid) returns public.shadow_ai_manual_authorizations language plpgsql security definer set search_path=public,pg_temp as $$
declare revoked public.shadow_ai_manual_authorizations;
begin update public.shadow_ai_manual_authorizations set revoked_at=clock_timestamp() where authorization_id=p_authorization_id and consumed_at is null and revoked_at is null returning * into revoked; if revoked.authorization_id is null then raise exception 'manual_authorization_not_revocable'; end if; return revoked; end $$;
revoke all on function public.authorize_shadow_ai_manual_message(uuid,uuid,text,text,integer) from public,anon,authenticated;
revoke all on function public.consume_shadow_ai_manual_authorization(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.revoke_shadow_ai_manual_authorization(uuid) from public,anon,authenticated;
grant execute on function public.authorize_shadow_ai_manual_message(uuid,uuid,text,text,integer) to service_role;
grant execute on function public.consume_shadow_ai_manual_authorization(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.revoke_shadow_ai_manual_authorization(uuid) to service_role;
commit;
