-- DEV ONLY (hjfwjnejbcpmknvfpdcq). RPC-state certification, NOT agent delivery.
-- Fixtures are created AND deleted in this single short transaction. No fixture
-- becomes visible to a hosted background worker. Exception => entire rollback.
begin;
set local statement_timeout='20s';
select set_config('queueqa.prefix','synthetic-q170-rpc-'||gen_random_uuid()::text,true);
do $$
declare lane text; scenario text; contact text; event_id text; payload jsonb; r jsonb; c jsonb; d jsonb;
 i uuid; token uuid; first_token uuid; target text; run_table text; run_id uuid; outbound_before jsonb; n int:=0;
begin
 if exists(select 1 from public.respond_commercial_jobs) or exists(select 1 from public.respond_commercial_executions)
 then raise exception 'DEV fixture isolation requires empty commercial queues'; end if;
 foreach lane in array array['SALES','OWNER','LEGAL'] loop
 target:=case lane when 'SALES' then 'sales_agent_v2' when 'OWNER' then 'owner_agent_v1' else 'legal_agent_v1' end;
 run_table:=target||case when lane='SALES' then '_shadow_runs' else '_runs' end;
 foreach scenario in array array['confirmed_failure','crash_before_model','uncertain_model','reserved_effect','human_between_attempts','exhaustion','historical_without_journal','dispatch_started','sent','delivery_unknown'] loop
   contact:=current_setting('queueqa.prefix')||'-'||lane||'-'||scenario;event_id:=contact||'-event';
   payload:=jsonb_build_object('event_id',event_id,'event_type','message.received','respond_contact_id',contact,'channel_id','497382','message_id',contact||'-message','event_occurred_at',now(),'payload_meta',jsonb_build_object('channel_id','497382'));
   execute 'set local role service_role';
   r:=public.enqueue_respond_commercial_v1(payload,'{"version":1,"text":"fixture sintético RPC","references":{"publicIds":[]}}');
   if r->>'durable'<>'true' then raise exception 'DEV enqueue not durable'; end if;
   r:=public.capture_social_route_v1(jsonb_build_object('source_event_id',event_id,'source_channel_id','497382','source_message_id',contact||'-message',
     'respond_contact_id',contact,'source_platform','instagram','destination',lane,'reason','synthetic_certification','identity_status','unresolved','occurred_at',now(),'sanitized_text','fixture sintético RPC'));
   i:=(r->>'inboundId')::uuid;
   if i is null then raise exception 'DEV specialized input missing'; end if;
   if scenario='historical_without_journal' then
     execute format('update public.%I set status=''failed'' where id=$1',target||'_inbound_messages') using i;
     c:=public.claim_respond_execution_v1(lane,i,true);
     if c->>'authorized' is distinct from 'false' or exists(select 1 from public.respond_commercial_executions where inbound_id=i)
       then raise exception 'DEV historical adoption forbidden'; end if;
   else
     c:=public.claim_respond_execution_v1(lane,i,true);token:=(c->>'token')::uuid;first_token:=token;
     if c->>'authorized'<>'true' then raise exception 'DEV first claim missing'; end if;
     d:=public.claim_respond_execution_v1(lane,i,true);
     if d->>'authorized' is distinct from 'false' then raise exception 'DEV exclusive claim violated'; end if;
     if scenario<>'crash_before_model' then
       d:=public.step_respond_execution_v1(i,token,'model');if d->>'allowed'<>'true' then raise exception 'DEV model fence denied'; end if;
     end if;
     if scenario in ('uncertain_model','reserved_effect','crash_before_model') then
       if scenario='reserved_effect' then perform public.step_respond_execution_v1(i,token,'tools');end if;
       execute 'reset role';
       update public.respond_commercial_executions set lease_until=now()-interval '1 second' where inbound_id=i;
       execute 'set local role service_role';
       c:=public.claim_respond_execution_v1(lane,i,true);
       if scenario='crash_before_model' then
         if c->>'authorized'<>'true' then raise exception 'DEV pre-model crash not recovered'; end if;
         token:=(c->>'token')::uuid;
         if (public.step_respond_execution_v1(i,first_token,'model')->>'allowed') is distinct from 'false' then raise exception 'DEV stale token accepted'; end if;
         perform public.step_respond_execution_v1(i,token,'model');perform public.step_respond_execution_v1(i,token,'effects');perform public.step_respond_execution_v1(i,token,'complete');
       elsif c->>'state'<>'review_required' then raise exception 'DEV uncertain effect retried';end if;
     else
       d:=public.step_respond_execution_v1(i,token,'model_failed',repeat('a',64));
       if d->>'state'<>'retryable' then raise exception 'DEV confirmed failure not recoverable'; end if;
       -- Existing #165 guard must still reject resetting this input.
       begin
         execute format('update public.%I set status=''captured'' where id=$1',target||'_inbound_messages') using i;
         raise exception 'DEV forbidden reset succeeded';
       exception when sqlstate 'P0001' then
         if sqlerrm<>'social_reexecution_requires_review' then raise;end if;
       end;
       if scenario='human_between_attempts' then
         insert into public.gv_respond_webhook_events(event_id,event_type,respond_contact_id,event_occurred_at,payload_meta,status)
           values(contact||'-human','message.sent',contact,now()+interval '1 millisecond','{"sender_source":"user"}','processed');
       elsif scenario in ('dispatch_started','sent','delivery_unknown') then
         execute format('insert into public.%I(inbound_message_id,session_id,status,called_tools,proposed_response) values($1,$2,''idle'',''[]'',''fixture no entregable'') returning id',run_table) into run_id using i,contact||'-session';
         if lane='SALES' then
           insert into public.sales_agent_v2_auto_outbound(inbound_message_id,shadow_run_id,respond_contact_id,channel_id,case_kind,status,error_code,proposed_message)
             values(i,run_id,contact,'497382','greeting_qualification',case when scenario='sent' then 'sent' when scenario='delivery_unknown' then 'failed' else 'processing' end,
             case when scenario='sent' then null when scenario='delivery_unknown' then 'respond_delivery_unknown' else 'dispatch_started' end,'fixture no entregable');
         else
           execute format('insert into public.%I(inbound_message_id,run_id,respond_contact_id,channel_id,status,error_code,proposed_message) values($1,$2,$3,''497382'',$4,$5,''fixture no entregable'')',target||'_auto_outbound')
             using i,run_id,contact,case when scenario='sent' then 'sent' when scenario='delivery_unknown' then 'failed' else 'processing' end,
               case when scenario='sent' then null when scenario='delivery_unknown' then 'respond_delivery_unknown' else 'dispatch_started' end;
         end if;
         execute format('select to_jsonb(o) from public.%I o where inbound_message_id=$1',target||'_auto_outbound') into outbound_before using i;
       end if;
       execute 'reset role';
       update public.respond_commercial_executions set next_attempt_at=now()-interval '1 second' where inbound_id=i;
       execute 'set local role service_role';
       c:=public.claim_respond_execution_v1(lane,i,true);
       if scenario='human_between_attempts' then
         if c->>'state'<>'paused' then raise exception 'DEV human pause lost';end if;
       elsif scenario in ('dispatch_started','sent','delivery_unknown') then
         if c->>'state'<>'review_required' then raise exception 'DEV outbound retried';end if;
         execute format('select to_jsonb(o) from public.%I o where inbound_message_id=$1',target||'_auto_outbound') into d using i;
         if d is distinct from outbound_before then raise exception 'DEV outbound evidence changed';end if;
       else
         if c->>'authorized'<>'true' then raise exception 'DEV recovery denied';end if;token:=(c->>'token')::uuid;
         if (public.claim_respond_execution_v1(lane,i,true)->>'authorized') is distinct from 'false' then raise exception 'DEV second attempt not exclusive';end if;
         perform public.step_respond_execution_v1(i,token,'model');
         if scenario='exhaustion' then
           d:=public.step_respond_execution_v1(i,token,'model_failed',repeat('b',64));
           if d->>'state'<>'review_required' or d->>'reason'<>'attempts_exhausted' then raise exception 'DEV exhaustion did not stop';end if;
         else
           perform public.step_respond_execution_v1(i,token,'effects');perform public.step_respond_execution_v1(i,token,'verify');
           d:=public.step_respond_execution_v1(i,token,'complete');if d->>'state'<>'complete' then raise exception 'DEV completion failed';end if;
         end if;
       end if;
     end if;
     -- A provider duplicate cannot create an execution/attempt or reopen a terminal.
     r:=public.enqueue_respond_commercial_v1(payload,'{"version":1,"text":"fixture sintético RPC","references":{"publicIds":[]}}');
     if r->>'duplicate'<>'true' then raise exception 'DEV duplicate not recognized';end if;
     if (public.claim_respond_execution_v1(lane,i,true)->>'authorized') is distinct from 'false' then raise exception 'DEV terminal reopened';end if;
   end if;
   execute 'reset role';
   execute format('delete from public.%I where respond_contact_id=$1',target||'_auto_outbound') using contact;
   execute format('delete from public.%I where inbound_message_id=$1',run_table) using i;
   delete from public.respond_commercial_executions where inbound_id=i;
   execute format('delete from public.%I where id=$1',target||'_inbound_messages') using i;
   delete from public.respond_commercial_jobs where respond_contact_id=contact;
   delete from public.social_capture_receipts where respond_contact_id=contact;
   delete from public.social_message_routes where respond_contact_id=contact;
   delete from public.gv_respond_webhook_events where respond_contact_id=contact;
   n:=n+1;
 end loop;
 end loop;
 if exists(select 1 from public.gv_respond_webhook_events where respond_contact_id like current_setting('queueqa.prefix')||'%')
   or exists(select 1 from public.respond_commercial_jobs) or exists(select 1 from public.respond_commercial_executions) then raise exception 'DEV cleanup incomplete';end if;
 perform set_config('queueqa.result',jsonb_build_object('result','PASS','scenarios',n,'lanes',jsonb_build_array('SALES','OWNER','LEGAL'),'residues',0,
   'external_calls',0,'mode','real DEV RPC state transitions; no model/provider invocation; fixtures invisible outside transaction')::text,true);
end $$;
select current_setting('queueqa.result')::jsonb as certification;
commit;
