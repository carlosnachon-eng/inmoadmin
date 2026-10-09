-- Requires #185 media capture migration. No historical counter reconstruction.
begin;
alter table meta_admin_private.shadow_once_runs
 add column media_model_calls integer not null default 0 check(media_model_calls between 0 and 1);
alter table meta_admin_private.shadow_once_runs drop constraint shadow_once_runs_check;
alter table meta_admin_private.shadow_once_runs add constraint shadow_once_runs_check check(
 (model_calls=0 and status in ('claimed','model_started','blocked','uncertain')
   and model_started_at is null and run_id is null and proposed_response is null)
 or (model_calls=1 and status in ('model_started','complete','invalidated','uncertain') and model_started_at is not null));
alter table meta_admin_private.shadow_once_runs add constraint shadow_media_after_start check(
 media_model_calls=0 or status in ('model_started','blocked','uncertain','complete','invalidated'));

-- start consumes the execution, not an Admin model call. Legacy status name is
-- retained to keep the media reservation's token/state contract unchanged.
create or replace function public.meta_admin_shadow_start_v1(p_input_id uuid,p_token uuid)
returns boolean language sql volatile security definer set search_path='' as $$
with won as (
 update meta_admin_private.shadow_once_runs set status='model_started'
 where input_id=p_input_id and claim_token=p_token and status='claimed'
 and model_calls=0 and media_model_calls=0 returning input_id
) select exists(select 1 from won)
$$;

create function public.meta_admin_shadow_admin_model_start_v1(p_input_id uuid,p_token uuid)
returns boolean language sql volatile security definer set search_path='' as $$
with won as (
 update meta_admin_private.shadow_once_runs r
 set model_calls=1,model_started_at=clock_timestamp()
 where input_id=p_input_id and claim_token=p_token and status='model_started' and model_calls=0
 and (media_model_calls=1 or not exists(select 1 from meta_admin_private.media_shadow_attempts m where m.input_id=r.input_id))
 returning input_id
) select exists(select 1 from won)
$$;

create function public.meta_admin_shadow_media_model_start_v1(p_input_id uuid,p_token uuid)
returns boolean language sql volatile security definer set search_path='' as $$
with won as (
 update meta_admin_private.shadow_once_runs r set media_model_calls=1
 where input_id=p_input_id and claim_token=p_token and status='model_started'
 and model_calls=0 and media_model_calls=0
 and exists(select 1 from meta_admin_private.media_shadow_attempts m where m.input_id=r.input_id)
 returning input_id
) select exists(select 1 from won)
$$;

create or replace function public.meta_admin_shadow_finish_v1(p_input_id uuid,p_token uuid,p_status text,p_reason text,p_run_id text,p_proposal text)
returns boolean language sql volatile security definer set search_path='' as $$
with won as (
 update meta_admin_private.shadow_once_runs
 set status=p_status,reason=p_reason,run_id=p_run_id,proposed_response=p_proposal,finished_at=clock_timestamp()
 where input_id=p_input_id and claim_token=p_token
 and ((p_status='blocked' and model_calls=0 and p_run_id is null and p_proposal is null)
 or (p_status in ('complete','invalidated') and model_calls=1 and length(p_run_id)>0 and length(p_proposal) between 1 and 2000)
 or (p_status='uncertain' and p_run_id is null and p_proposal is null))
 and ((status='claimed' and p_status='blocked')
 or (status='model_started' and p_status in ('blocked','complete','invalidated','uncertain')))
 returning input_id
) select exists(select 1 from won)
$$;
revoke all on function public.meta_admin_shadow_admin_model_start_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_shadow_admin_model_start_v1(uuid,uuid) to service_role;
revoke all on function public.meta_admin_shadow_media_model_start_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_shadow_media_model_start_v1(uuid,uuid) to service_role;
revoke all on function public.meta_admin_shadow_start_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_shadow_start_v1(uuid,uuid) to service_role;
revoke all on function public.meta_admin_shadow_finish_v1(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_shadow_finish_v1(uuid,uuid,text,text,text,text) to service_role;
-- Existing start/finish ACL, RLS and table/column revocations are preserved.
-- No reset, reclaim, delete, counter decrement, or caller is introduced.
commit;
