-- DEV ONLY: synthetic fixtures are transaction-local; ROLLBACK is mandatory.
-- Execute only in inmoadmin-dev after the new migration. No cron/provider calls.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ begin
 if exists(select 1 from public.gv_respond_webhook_events where event_id like 'qa-social-capture-p1-%') then
   raise exception 'qa_fixture_prefix_not_empty';
 end if;
end $$;
set local role service_role;
do $$
declare i integer; j integer; e text; c text; at_time timestamptz; h jsonb; r jsonb; p jsonb;
 result jsonb; checks text[]:='{}'; worker uuid:=gen_random_uuid(); old_route uuid;
begin
 -- Deliberately received T+2, then T, then equal T+2. Synthetic destinations
 -- exercise the REAL production SQL; JS classification is tested separately.
 for i in 1..9 loop
   e:='qa-social-capture-p1-'||i;
   c:=case when i<=4 then 'qa-social-capture-p1-owner' else 'qa-social-capture-p1-contact-'||i end;
   at_time:=case when i=2 then '2030-01-01T12:00:00Z'::timestamptz else '2030-01-01T12:00:02Z'::timestamptz end;
   insert into public.gv_respond_webhook_events(event_id,event_type,respond_contact_id,message_id,event_occurred_at,payload_meta)
   values(e,'message.received',c,e,at_time,jsonb_build_object('channel_id','497382','social_capture_required',true));
   h:=public.begin_social_capture_v1(e);
   if h->>'state'<>'pending' then raise exception 'qa_pending_missing'; end if;
   h:=public.read_social_route_context_v1(c,'497382',at_time);
   p:=jsonb_build_object('source_event_id',e,'source_message_id',e,'respond_contact_id',c,'source_channel_id','497382',
     'source_platform','instagram','occurred_at',at_time,'previous_route_id',h#>>'{current,id}',
     'destination',case when i in (1,3,4) then 'OWNER' when i=5 then 'LEGAL' when i=6 then 'ADMINISTRATION' else 'SALES' end,
     'reason',case when i in(3,4) then 'conversation_continuity' else 'owner_intent' end,
     'identity_status','unresolved','sanitized_text','Consulta QA sintética');
   if i=8 then
     -- Actual SQL constraint failure rolls back RPC atomically; safe diagnostic
     -- is supplied separately, exactly as the application wrapper does.
     begin
       perform public.capture_social_route_v1(p||'{"destination":"INVALID_QA_DESTINATION"}'::jsonb);
       raise exception 'qa_constraint_was_not_enforced';
     exception when check_violation then null;
     end;
     result:=public.fail_social_capture_v1(e,'23514','capture_rpc_failed','capture_rpc');
     if result->>'state'<>'review_required' then raise exception 'qa_missing_review'; end if;
     for j in 1..3 loop
       if public.begin_social_capture_v1(e)->>'state'<>'review_required' then raise exception 'qa_review_reopened'; end if;
     end loop;
     update public.gv_respond_webhook_events set status='processing',locked_by=worker,last_error='synthetic_worker_failure' where event_id=e;
     perform public.apply_respond_snapshot_and_complete_events(null,array[e],worker);
     if not exists(select 1 from public.social_capture_receipts s join public.gv_respond_webhook_events v on v.event_id=s.source_event_id
       where s.source_event_id=e and s.routing_state='review_required' and s.attempts=4 and s.sqlstate='23514' and v.status='processed' and v.last_error is null) then
       raise exception 'qa_worker_hid_commercial_failure';
     end if;
     if exists(select 1 from public.social_message_routes where source_event_id=e) then raise exception 'qa_failed_rpc_partial_route'; end if;
     checks:=array_append(checks,'real_constraint_failure_4_deliveries_1_review_snapshot_processed');
     continue;
   end if;
   r:=public.capture_social_route_v1(p);
   if i=1 then old_route:=(r->>'routeId')::uuid; end if;
   if i=2 then
     if r->>'destination'<>'HUMAN_REVIEW' or r->>'inboundId' is not null then raise exception 'qa_late_routing_incorrect'; end if;
     for j in 1..3 loop
       if public.begin_social_capture_v1(e)->>'state'<>'review_required' then raise exception 'qa_late_review_reopened'; end if;
     end loop;
     checks:=array_append(checks,'T_plus_2_before_T_no_P0001_late_review_4_deliveries');
   else
     if r->>'destination'<>p->>'destination' then raise exception 'qa_wrong_destination'; end if;
     if public.begin_social_capture_v1(e)->>'state'<>'routed' then raise exception 'qa_route_not_durable'; end if;
   end if;
   if i=4 then
     -- Deterministic equal timestamps; stale head fails, fresh head succeeds.
     begin
       perform public.capture_social_route_v1(p||jsonb_build_object('source_event_id','qa-social-capture-p1-cas','source_message_id','qa-social-capture-p1-cas','previous_route_id',old_route));
       raise exception 'qa_stale_cas_was_not_rejected';
     exception when raise_exception then
       if sqlerrm<>'social_context_changed_requires_review' then raise; end if;
     end;
     checks:=array_append(checks,'equal_timestamps_stable_order_OWNER_and_stale_CAS');
   end if;
 end loop;
 checks:=array_append(checks,'SALES_OWNER_LEGAL_ADMIN_exclusive_real_inbound_binding');
 if (select count(*) from public.social_message_routes where source_event_id like 'qa-social-capture-p1-%')<>8 then raise exception 'qa_route_count'; end if;
 if (select count(*) from public.social_capture_receipts where source_event_id like 'qa-social-capture-p1-%')<>9 then raise exception 'qa_receipt_count'; end if;
 if (select count(*) from public.sales_agent_v2_inbound_messages where event_id like 'qa-social-capture-p1-%')<>2 then raise exception 'qa_sales_count'; end if;
 if (select count(*) from public.owner_agent_v1_inbound_messages where event_id like 'qa-social-capture-p1-%')<>3 then raise exception 'qa_owner_count'; end if;
 if (select count(*) from public.legal_agent_v1_inbound_messages where event_id like 'qa-social-capture-p1-%')<>1 then raise exception 'qa_legal_count'; end if;
 if exists(select 1 from public.sales_agent_v2_auto_outbound where respond_contact_id like 'qa-social-capture-p1-%') then raise exception 'qa_outbound_detected'; end if;
 if exists(select 1 from public.sales_agent_v2_handoffs where respond_contact_id like 'qa-social-capture-p1-%') then raise exception 'qa_handoff_detected'; end if;
 checks:=array_append(checks,'zero_outbound_handoff_assignment_models_Respond');
 perform set_config('qa.social_capture_result',jsonb_build_object('result','DEV_DB_RPC_PASS','checks',checks,'transport_rows',9,'receipts',9,'routes',8,'inbounds',6,'fixture_scope','uncommitted_transaction_rollback')::text,true);
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.social_capture_receipts;raise exception 'qa_anon_read_open';exception when insufficient_privilege then null;end;
 begin perform public.begin_social_capture_v1('qa-social-capture-p1-1');raise exception 'qa_anon_rpc_open';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin perform 1 from public.social_capture_receipts;raise exception 'qa_authenticated_read_open';exception when insufficient_privilege then null;end;
 begin perform public.begin_social_capture_v1('qa-social-capture-p1-1');raise exception 'qa_authenticated_rpc_open';exception when insufficient_privilege then null;end;
end $$;
reset role;
select current_setting('qa.social_capture_result')::jsonb as result, true as anon_authenticated_denied;
rollback;
-- Fresh read after transaction end; these counts must ALL be zero.
select (select count(*) from public.gv_respond_webhook_events where event_id like 'qa-social-capture-p1-%') as transport_residues,
 (select count(*) from public.social_capture_receipts where source_event_id like 'qa-social-capture-p1-%') as receipt_residues,
 (select count(*) from public.social_message_routes where source_event_id like 'qa-social-capture-p1-%') as route_residues,
 (select count(*) from public.sales_agent_v2_inbound_messages where event_id like 'qa-social-capture-p1-%') as sales_residues,
 (select count(*) from public.owner_agent_v1_inbound_messages where event_id like 'qa-social-capture-p1-%') as owner_residues,
 (select count(*) from public.legal_agent_v1_inbound_messages where event_id like 'qa-social-capture-p1-%') as legal_residues;
