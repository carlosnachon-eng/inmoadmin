-- REVIEW DRAFT only. Requires existing shadow_once_runs journal. Not remotely applied.
begin;
create function public.meta_admin_shadow_snapshot_v1(p_input_id uuid)
returns jsonb language sql volatile security definer set search_path='' as $snapshot$
with recursive target as (
 select i.id,i.native_message_id,i.waba_id,i.phone_number_id,i.occurred_at,i.captured_at,
 i.sanitized_text,i.capture_reason,i.message_type,m.observer_only,m.state observer_state,
 c.enabled and s.enabled as enabled,s.respond_channel_id scope_channel,
 i.sender_ref subject_ref,se.key_tag
 from meta_admin_private.inbound_inputs i
 join public.meta_observer_events m on m.id=i.meta_observer_event_id
 join meta_admin_private.capture_config c on c.waba_id=i.waba_id and c.phone_number_id=i.phone_number_id
 join public.meta_observer_admin_scope s on s.waba_id=i.waba_id and s.phone_number_id=i.phone_number_id
 left join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 where i.id=$1 and i.captured_at>=c.not_before and i.occurred_at>=c.not_before
), echo_roots as (
 select m.id from public.meta_observer_events m join target i using(waba_id,phone_number_id)
 where m.category='app_echo' and (m.occurred_at>=i.occurred_at or m.received_at>=i.captured_at)
), subject_walk(id) as (
 select id from echo_roots
 union
 select parent.id from subject_walk w
 join public.meta_observer_events m on m.id=w.id
 left join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 join public.meta_observer_events parent on parent.waba_id=m.waba_id and parent.phone_number_id=m.phone_number_id
   and parent.category in ('inbound','app_echo')
   and parent.native_message_id in (se.context_id,m.original_message_id)
), subject_nodes as (
 select m.id event_id,m.native_message_id,m.waba_id,m.phone_number_id,m.original_message_id,
 se.subject_ref,se.key_tag,se.context_id,se.evidence_state
 from subject_walk w join public.meta_observer_events m on m.id=w.id
 left join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 where m.observer_only and m.state='observed' limit 1001
)
select jsonb_build_object('input',to_jsonb(i)-array['enabled','scope_channel'],
 'enabled',i.enabled,'scope_channel',i.scope_channel,'checked_at',statement_timestamp(),
 'identity',public.resolve_meta_admin_identity_v1(i.id),
 'latest_received_at',(select max(m.received_at) from public.meta_observer_events m
   where m.waba_id=i.waba_id and m.phone_number_id=i.phone_number_id),
 'mutated',exists(select 1 from public.meta_observer_events m where m.waba_id=i.waba_id
   and m.phone_number_id=i.phone_number_id and m.original_message_id=i.native_message_id),
 'later_scope_echoes',(select count(*) from echo_roots),
 'echo_roots',coalesce((select jsonb_agg(id) from echo_roots),'[]'::jsonb),
 'subject_nodes',coalesce((select jsonb_agg(to_jsonb(n)) from subject_nodes n),'[]'::jsonb),
 'later_scope_uncertain',(select count(*) from public.meta_observer_events m
   where m.waba_id=i.waba_id and m.phone_number_id=i.phone_number_id
   and (m.occurred_at>=i.occurred_at or m.received_at>=i.captured_at)
   and (m.state<>'observed' or not m.observer_only or cardinality(m.error_codes)>0))
) snapshot from target i
$snapshot$;
create function public.meta_admin_shadow_claim_v1(p_input_id uuid,p_token uuid,p_fingerprint text,p_identity text,p_provider text,p_model text)
returns boolean language sql volatile security definer set search_path='' as $claim$
with won as (
 insert into meta_admin_private.shadow_once_runs
 (input_id,claim_token,input_fingerprint,identity_state,provider,model)
 select p_input_id,p_token,p_fingerprint,p_identity,p_provider,p_model
 where exists(select 1 from meta_admin_private.inbound_inputs i where i.id=p_input_id
 and i.waba_id='1297760461811288' and i.phone_number_id='1198305790026665')
 on conflict(input_id) do nothing returning input_id
) select exists(select 1 from won)
$claim$;
create function public.meta_admin_shadow_start_v1(p_input_id uuid,p_token uuid)
returns boolean language sql volatile security definer set search_path='' as $start$
with won as (
 update meta_admin_private.shadow_once_runs
 set status='model_started',model_calls=1,model_started_at=clock_timestamp()
 where input_id=p_input_id and claim_token=p_token and status='claimed' and model_calls=0
 returning input_id
) select exists(select 1 from won)
$start$;
create function public.meta_admin_shadow_finish_v1(p_input_id uuid,p_token uuid,p_status text,p_reason text,p_run_id text,p_proposal text)
returns boolean language sql volatile security definer set search_path='' as $finish$
with won as (
 update meta_admin_private.shadow_once_runs
 set status=p_status,reason=p_reason,run_id=p_run_id,proposed_response=p_proposal,finished_at=clock_timestamp()
 where input_id=p_input_id and claim_token=p_token
 and ((p_status='blocked' and p_run_id is null and p_proposal is null)
 or (p_status in ('complete','invalidated') and length(p_run_id)>0 and length(p_proposal) between 1 and 2000)
 or (p_status='uncertain' and p_run_id is null and p_proposal is null))
 and ((status='claimed' and p_status='blocked')
 or (status='model_started' and p_status in ('complete','invalidated','uncertain')))
 returning input_id
) select exists(select 1 from won)
$finish$;
revoke all on function public.meta_admin_shadow_snapshot_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_shadow_snapshot_v1(uuid) to service_role;
revoke all on function public.meta_admin_shadow_claim_v1(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_shadow_claim_v1(uuid,uuid,text,text,text,text) to service_role;
revoke all on function public.meta_admin_shadow_start_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_shadow_start_v1(uuid,uuid) to service_role;
revoke all on function public.meta_admin_shadow_finish_v1(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.meta_admin_shadow_finish_v1(uuid,uuid,text,text,text,text) to service_role;
-- Remove both table AND pre-existing column grants: table REVOKE alone does
-- not revoke UPDATE(column) inherited from the original journal installation.
revoke all on meta_admin_private.shadow_once_runs from public,anon,authenticated,service_role;
revoke update(status,reason,model_calls,run_id,proposed_response,model_started_at,finished_at)
 on meta_admin_private.shadow_once_runs from public,anon,authenticated,service_role;
-- No defaults or source-table ACLs change. Fixed SQL, no dynamic queries,
-- no generic private-schema API, listing, reset, delete or replay operations.
commit;
