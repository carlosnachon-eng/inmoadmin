import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createServer, request } from "node:http";
import { localPgAdapter } from "./localPgAdapter.mjs";
import { importWithStubs } from "./socialFixtures.mjs";
import { enqueueCommercialEvent, processCommercialQueueOne } from "../../lib/social/commercialQueue.js";
import * as webhook from "../../lib/ejecutivo/respondWebhook.js";
import { sanitizeShadowText } from "../../lib/shadow/coordinator.js";
import * as handoffs from "../../lib/agentsV2/salesHandoff.js";
import * as outbound from "../../lib/agentsV2/salesAutoOutbound.js";
import { recoverCommercialExecutionOne } from "../../lib/social/commercialExecution.js";

// Shared by disposable PostgreSQL and connected DEV. Only model/provider IO is
// intercepted; receiver, queue RPCs, routing, lane processors and #168 are real.
export async function certifyCommercialQueue({ db, service, other, saveManifest = async()=>{} }) {
  const prefix = "synthetic-q170-" + randomUUID();
  await saveManifest({ prefix });
  const checks=[], timings=[], sends=[], models=[], latency=[], recoveryGaps=[];
  let hook=async()=>{};
  let modelStatus="idle";
  const getModel=async()=>({id:"synthetic-session",status:modelStatus});
  let sendHook=async()=>{};
  const env={SOCIAL_ROUTING_V1_ENABLED:"true",SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED:"true",
    SALES_AGENT_V2_AUTO_SHADOW_ENABLED:"true",RESPOND_IO_TOKEN:"synthetic-intercepted-only",
    SUPABASE_ENVIRONMENT:"production",VERCEL_ENV:"production"};
  const admin=localPgAdapter(service), second=localPgAdapter(other);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.ok(String(url).startsWith("https://api.respond.io/v2/contact/id:"+prefix),"nonfixture network forbidden");
    assert.ok(String(url).endsWith("/message"));assert.equal(options.method,"POST");
    sends.push({url,body:JSON.parse(options.body)});
    await sendHook();
    return {ok:true,json:async()=>({messageId:"intercepted-"+randomUUID()})};
  };
  const output="¿Cuál es tu presupuesto para el departamento en renta?";
  const create=async(args)=>{models.push(args);await hook();return{id:"synthetic-session"};};
  const common={"../ejecutivo/respondSync":{readRespondMessages:async()=>({messages:[]}),respondMessageTimestamp:r=>r.at},
    "../shadow/coordinator":{sanitizeShadowText},"./agentUsage":{safeAgentUsage:async()=>({})}};
  const salesRunner=await importWithStubs(new URL("../../lib/agentsV2/runSalesShadowMessage.js",import.meta.url),{
    ...common,"./openaiSalesAgent":{assertSalesAgentV2ShadowEnvironment:()=>{},createSalesSession:create,
      getSalesSession:getModel,fulfillSalesActions:()=>assert.fail(),
      salesSessionItems:async()=>[],salesAssistantOutput:()=>output},
  });
  const sales=await importWithStubs(new URL("../../lib/agentsV2/processSalesInbound.js",import.meta.url),{
    ...common,"./runSalesShadowMessage":salesRunner,"./salesHandoff":handoffs,"./salesAutoOutbound":outbound,
    "./openaiSalesAgent":{salesAgentModel:()=>"synthetic"},
  });
  const owner=await importWithStubs(new URL("../../lib/agentsV2/processOwnerInbound.js",import.meta.url),{
    ...common,"./openaiOwnerAgent":{createOwnerSession:create,getOwnerSession:getModel,
      fulfillOwnerActions:()=>assert.fail(),ownerOutput:async()=>output},
  });
  const legal=await importWithStubs(new URL("../../lib/agentsV2/processLegalInbound.js",import.meta.url),{
    ...common,"./openaiLegalAgent":{createLegalSession:create,getLegalSession:getModel,
      fulfillLegal:()=>assert.fail(),legalOutput:async()=>output},"./legalHandoff":{createAndDispatchLegalHandoff:()=>assert.fail()},
  });
  const processors={SALES:sales.processSalesInboundById,OWNER:owner.processOwnerInboundById,LEGAL:legal.processLegalInboundById};
  // Most scenarios skip wall-clock debounce only; the latency scenario below
  // uses the real 4-second debounce and a deliberately slow intercepted model.
  const work=(client=admin,options={})=>processCommercialQueueOne(client,{env,processors,sleep:async()=>{},...options});
  const recover=(client=admin)=>recoverCommercialExecutionOne(client,{env,processors});
  const ready=async f=>db.query("update respond_commercial_executions set next_attempt_at=now()-interval '1 second' where event_id=$1",[f.event.eventId]);
  const journal=async f=>(await service.query("select * from respond_commercial_executions where event_id=$1",[f.event.eventId])).rows[0];
  const cases={SALES:"Busco departamento en renta",OWNER:"Soy propietario, quiero vender mi casa",LEGAL:"Qué incluye la póliza jurídica"};
  const check=async(label,fn)=>{await fn();checks.push(label);};
  const fixture=(destination="SALES",channel="497382",contact=prefix+"-"+randomUUID(),at=new Date().toISOString())=>{
    const event={eventId:prefix+"-"+randomUUID(),eventType:"message.received",respondContactId:contact,
      channelId:channel,messageId:prefix+"-"+randomUUID(),eventOccurredAt:at,payloadMeta:{channel_id:channel}};
    return {event,body:{event_id:event.eventId,event_type:event.eventType,contact:{id:contact},
      message:{messageId:event.messageId,channelId:channel,timestamp:at,text:cases[destination]}}};
  };
  const enqueue=f=>enqueueCommercialEvent(admin,f.body,f.event);
  const route=async f=>(await service.query("select * from social_message_routes where source_event_id=$1",[f.event.eventId])).rows[0];
  const process=async f=>{
    const r=await route(f);assert.ok(r);const lane={SALES:"sales_agent_v2",OWNER:"owner_agent_v1",LEGAL:"legal_agent_v1"}[r.destination];
    const i=(await service.query(`select id from ${lane}_inbound_messages where social_route_id=$1`,[r.id])).rows[0];
    return processors[r.destination](admin,i.id,{env});
  };
  const human=async f=>service.query("insert into gv_respond_webhook_events(event_id,event_type,respond_contact_id,event_occurred_at,payload_meta,status) values($1,'message.sent',$2,now(),'{\"sender_source\":\"user\"}','processed')",[prefix+"-human-"+randomUUID(),f.event.respondContactId]);
  const receiver=await importWithStubs(new URL("../../pages/api/webhooks/respond.js",import.meta.url),{
    "../../../lib/ejecutivo/workCenter":{assertSupabaseEnvironment:()=>{},getAdminSupabase:()=>admin},
    "../../../lib/ejecutivo/respondSync":{assertRespondIncrementalWebhooksEnabled:()=>{}},
    "../../../lib/ejecutivo/respondWebhook":{...webhook,resolveRespondWebhookSigningKeys:()=>["synthetic-signature"]},
    "../../../lib/shadow/providers/respondAdmin":{captureRespondAdminShadowIsolated:()=>assert.fail()},
    "../../../lib/respond/channelRouter":{routeRespondMessageIsolated:()=>assert.fail()},
    "../../../lib/shadow/media/reference":{captureRespondMediaReferenceIsolated:()=>assert.fail()},
    "../../../lib/agentsV2/respondAppointmentSync":{captureRespondAppointmentLifecycleIsolated:()=>assert.fail()},
  });
  const server=createServer((req,res)=>{
    res.status=n=>{res.statusCode=n;return res;};res.json=v=>res.end(JSON.stringify(v));
    receiver.default(req,res).catch(()=>{res.statusCode=500;res.end('{}');});
  });
  await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});
  const receive=f=>new Promise((ok,no)=>{
    const body=JSON.stringify(f.body),start=performance.now();
    const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/webhooks/respond',method:'POST',
      headers:{'content-type':'application/json','x-webhook-signature':createHmac('sha256','synthetic-signature').update(body).digest('base64')}},res=>{
      let data='';res.on('data',b=>data+=b);res.on('end',()=>ok({res:{statusCode:res.statusCode,body:JSON.parse(data)},ms:performance.now()-start}));
    });req.on('error',no);req.end(body);
  });
  try {
    await check("queue ACL: RLS, service SELECT/internal EXECUTE only, anon/auth/PUBLIC denied",async()=>{
      const acl=(await db.query(`select relrowsecurity as rls,
        has_table_privilege('service_role','respond_commercial_jobs','SELECT') as service_read,
        not has_table_privilege('service_role','respond_commercial_jobs','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as service_no_write,
        not has_table_privilege('anon','respond_commercial_jobs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon_denied,
        not has_table_privilege('authenticated','respond_commercial_jobs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as authenticated_denied
        from pg_class where oid='respond_commercial_jobs'::regclass`)).rows[0];
      assert.ok(Object.values(acl).every(Boolean));
      const functions=(await db.query(`select p.proname,has_function_privilege('service_role',p.oid,'EXECUTE') as service,
        not has_function_privilege('anon',p.oid,'EXECUTE') as anon_denied,
        not has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_denied,
        not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_denied
        from pg_proc p where pronamespace='public'::regnamespace and proname in ('enqueue_respond_commercial_v1','claim_respond_commercial_v1','finish_respond_commercial_v1')`)).rows;
      assert.equal(functions.length,3);for(const f of functions)for(const [k,v] of Object.entries(f))if(k!=='proname')assert.equal(v,true);
      const executionAcl=(await db.query(`select relrowsecurity and has_table_privilege('service_role',oid,'SELECT')
        and not has_table_privilege('service_role',oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as ok
        from pg_class where oid='respond_commercial_executions'::regclass`)).rows[0];assert.equal(executionAcl.ok,true);
      const executionFunctions=(await db.query(`select p.proname,
        has_function_privilege('service_role',p.oid,'EXECUTE')=(p.proname<>'respond_execution_has_effect_v1') as service_exact,
        not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE')
        and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as no_public
        from pg_proc p where pronamespace='public'::regnamespace and proname in ('respond_execution_has_effect_v1','claim_respond_execution_v1','step_respond_execution_v1','next_respond_execution_v1')`)).rows;
      assert.equal(executionFunctions.length,4);assert.ok(executionFunctions.every(f=>f.service_exact&&f.no_public));
    });
    await check("atomic ACK and crash after 200 recovered by fresh worker",async()=>{
      const f=fixture();const {res,ms}=await receive(f);assert.equal(res.statusCode,200);assert.ok(ms<5000);timings.push(ms);
      assert.equal(await route(f),undefined);assert.equal(models.length,0);assert.equal(sends.length,0);
      assert.equal((await work(second)).status,"complete");
      assert.equal((await route(f)).destination,"SALES");
      await process(f);assert.equal(sends.length,1);
      const before=models.length;await receive(f);await process(f);assert.equal(models.length,before);assert.equal(sends.length,1);
    });
    await check("slow model (5.5s) cannot delay another HTTP ACK",async()=>{
      const slow=fixture(),begin=performance.now();await receive(slow);
      let started;const entered=new Promise(ok=>started=ok);hook=async()=>{started();await new Promise(ok=>setTimeout(ok,5500));};
      const run=work(admin,{sleep:undefined});await entered;
      const f=fixture();const {res,ms}=await receive(f);assert.equal(res.statusCode,200);assert.ok(ms<5000);timings.push(ms);
      await run;
      const measured=performance.now()-begin;
      latency.push({modelDelayMs:5500,realDebounce:true,receiptToOutboundMs:measured,
        simulatedWorkerPhaseMs:60000,simulatedEndToEndMs:60000+measured,secondCronWaitMs:0});
      assert.ok(measured>=5500&&measured<15000);
      hook=async()=>{};await work();await process(f);
    });
    await check("persistence/identity failure returns 503; no partial transport",async()=>{
      const f=fixture();f.event.messageId=null;f.body.message.messageId=null;
      const {res}=await receive(f);assert.equal(res.statusCode,503);
      assert.equal((await service.query("select count(*)::int n from gv_respond_webhook_events where event_id=$1",[f.event.eventId])).rows[0].n,0);
    });
    await check("job INSERT constraint failure rolls back transport and receipt atomically",async()=>{
      const f=fixture();const {data,error}=await admin.rpc('enqueue_respond_commercial_v1',{
        p_event:{event_id:f.event.eventId,event_type:'message.received',respond_contact_id:f.event.respondContactId,
          channel_id:f.event.channelId,message_id:f.event.messageId,event_occurred_at:f.event.eventOccurredAt},
        p_envelope:{version:1,text:'x'.repeat(2001),references:{publicIds:[]}},
      });assert.ok(error);assert.equal(data,null);
      assert.equal((await service.query('select count(*)::int n from gv_respond_webhook_events where event_id=$1',[f.event.eventId])).rows[0].n,0);
    });
    await check("concurrent deliveries and workers: one job/route/input/run/outbound",async()=>{
      const f=fixture();await Promise.all([enqueue(f),enqueueCommercialEvent(second,f.body,f.event)]);
      const n=sends.length;await Promise.all([work(),work(second)]);
      assert.equal(sends.length,n+1);await Promise.all([process(f),process(f)]);assert.equal(sends.length,n+1);
      const alias={...f,event:{...f.event,eventId:prefix+"-alias-"+randomUUID()}};
      assert.equal((await enqueue(alias)).duplicate,true);assert.equal((await processCommercialQueueOne(admin,{env})).status,"idle");
      const r=await route(f);assert.ok(r);
      assert.equal((await service.query("select count(*)::int n from respond_commercial_jobs where message_id=$1",[f.event.messageId])).rows[0].n,1);
    });
    await check("expired lease recovers; stale worker fenced after newer claim",async()=>{
      const f=fixture();await enqueue(f);const first=(await admin.rpc("claim_respond_commercial_v1",{})).data;
      await db.query("update respond_commercial_jobs set lease_until=now()-interval '1 second' where event_id=$1",[f.event.eventId]);
      await work(second);
      assert.equal((await admin.rpc("finish_respond_commercial_v1",{p_event_id:first.event_id,p_token:first.claim_token,p_state:"complete"})).data.state,"lease_lost");
      assert.ok(await route(f));
    });
    await check("same conversation FIFO: second job cannot be claimed while first lease held",async()=>{
      const f=fixture(),g=fixture('SALES','497382',f.event.respondContactId);await enqueue(f);await enqueue(g);
      const a=(await admin.rpc('claim_respond_commercial_v1',{})).data;assert.equal(a.event_id,f.event.eventId);
      assert.equal((await second.rpc('claim_respond_commercial_v1',{})).data,null);
      await db.query("update respond_commercial_jobs set lease_until=now()-interval '1 second' where event_id=$1",[f.event.eventId]);
      await processCommercialQueueOne(admin,{env});await processCommercialQueueOne(admin,{env});assert.ok(await route(g));
    });
    await check("capture commit then worker crash: terminal receipt reused, one input",async()=>{
      const f=fixture();await enqueue(f);
      const broken={from:admin.from.bind(admin),rpc:(n,a)=>n==='finish_respond_commercial_v1'?Promise.resolve({error:{code:'08006'}}):admin.rpc(n,a)};
      const count=models.length;await assert.rejects(work(broken),/finish_failed/);assert.equal(models.length,count);
      const id=(await route(f)).id;
      await db.query("update respond_commercial_jobs set lease_until=now()-interval '1 second' where event_id=$1",[f.event.eventId]);
      assert.equal((await work(second)).status,"complete");assert.equal((await route(f)).id,id);
      assert.equal(models.length,count,'queue recovery must not repeat an existing captured route');
      await process(f);assert.equal(models.length,count+1,'still-captured input recovered by existing lane');
    });
    for(const lane of Object.keys(cases))for(const channel of ["497382","497385","498219","515318"])
      await check(`${lane}/${channel}: capture → real processor → intercepted sent → duplicate no effect`,async()=>{
        const f=fixture(lane,channel),n=sends.length;await receive(f);const result=await work();assert.equal((await route(f)).destination,lane);
        assert.equal(result.laneAttempted,true);assert.equal(sends.length,n+1,'same worker reaches intercepted send without a lane cron');
        await process(f);await receive(f);await work();assert.equal(sends.length,n+1);
      });
    for(const lane of Object.keys(cases))await check(`${lane}: #168 before model and between model/send; later inbound stays paused`,async()=>{
      const f=fixture(lane);await receive(f);await human(f);
      let n=models.length,m=sends.length;await work();await process(f);assert.equal(models.length,n);assert.equal(sends.length,m);
      const later=fixture(lane,'497382',f.event.respondContactId);await receive(later);await work();await process(later);
      assert.equal(models.length,n);assert.equal(sends.length,m);
      const during=fixture(lane);await receive(during);hook=()=>human(during);
      await work();hook=async()=>{};assert.equal(sends.length,m);
    });
    await check("Social OFF holds job, never legacy capture; enable permits capture",async()=>{
      const f=fixture();await receive(f);assert.equal((await processCommercialQueueOne(admin,{env:{}})).status,'disabled');assert.equal(await route(f),undefined);
      await processCommercialQueueOne(admin,{env});assert.ok(await route(f));
    });
    await check("out-of-order after OWNER remains one review; duplicate cannot reopen",async()=>{
      const f=fixture('OWNER');await enqueue(f);await processCommercialQueueOne(admin,{env});
      const late=fixture('SALES','497382',f.event.respondContactId,new Date(Date.now()-60000).toISOString());
      await enqueue(late);await processCommercialQueueOne(admin,{env});assert.equal((await route(late)).destination,'HUMAN_REVIEW');
      await enqueue(late);assert.equal((await processCommercialQueueOne(admin,{env})).status,'idle');
    });
    await check("P0001 CAS uses #165 reread then bounded terminal review",async()=>{
      const f=fixture();await enqueue(f);let n=0;
      const cas={from:admin.from.bind(admin),rpc:(name,args)=>name==='capture_social_route_v1'?(n++,{error:{code:'P0001',message:'social_context_changed_requires_review'}}):admin.rpc(name,args)};
      assert.equal((await processCommercialQueueOne(cas,{env})).status,'review_required');assert.equal(n,3);
      await enqueue(f);assert.equal((await processCommercialQueueOne(admin,{env})).status,'idle');assert.equal(await route(f),undefined);
    });
    await check('failure before lane claim leaves captured input recoverable by that lane, not queue retry',async()=>{
      const f=fixture();await receive(f);const n=models.length,m=sends.length;
      const result=await work(admin,{processors:{SALES:async()=>{throw Error('synthetic_before_claim_failure');}}});
      assert.equal(result.status,'complete');assert.equal(result.laneStatus,'fallback_to_existing_lane');
      assert.equal(models.length,n);await receive(f);await work();assert.equal(models.length,n);
      await process(f);assert.equal(models.length,n+1);assert.equal(sends.length,m+1);
      await process(f);assert.equal(sends.length,m+1);
    });
    for(const lane of Object.keys(cases))await check(`${lane}: confirmed failed model → one durable recovery → one run/send`,async()=>{
      const f=fixture(lane);await receive(f);const n=models.length,m=sends.length;
      modelStatus='failed';await work();modelStatus='idle';
      assert.equal((await journal(f)).state,'retryable');assert.equal(sends.length,m);
      const r=await route(f),table={SALES:'sales_agent_v2',OWNER:'owner_agent_v1',LEGAL:'legal_agent_v1'}[lane];
      await assert.rejects(service.query(`update ${table}_inbound_messages set status='captured' where id=$1`,[r.inbound_id]),/social_reexecution_requires_review/);
      await receive(f);await work();assert.equal(models.length,n+1,'provider duplicate is not recovery authority');
      await ready(f);await recover();assert.equal(models.length,n+2);assert.equal(sends.length,m+1);
      assert.equal((await journal(f)).state,'complete');assert.equal((await journal(f)).attempts,2);
      assert.equal((await service.query(`select count(*)::int n from ${lane==='SALES'?table+'_shadow_runs':table+'_runs'} where inbound_message_id=$1`,[r.inbound_id])).rows[0].n,1);
      await process(f);await recover();assert.equal(models.length,n+2);assert.equal(sends.length,m+1);
    });
    for(const lane of Object.keys(cases))await check(`${lane}: ambiguous model create failure → review, never retry`,async()=>{
      const f=fixture(lane);await receive(f);const n=models.length,m=sends.length;
      hook=async()=>{throw Error('synthetic_model_failure');};const result=await work();hook=async()=>{};
      assert.equal(result.status,'complete');assert.equal((await journal(f)).state,'review_required');
      assert.equal(models.length,n+1);assert.equal(sends.length,m);
      const r=await route(f),table={SALES:'sales_agent_v2',OWNER:'owner_agent_v1',LEGAL:'legal_agent_v1'}[lane];
      const state=(await service.query(`select status from ${table}_inbound_messages where id=$1`,[r.inbound_id])).rows[0].status;
      assert.equal(state,'processing');
      await assert.rejects(service.query(`update ${table}_inbound_messages set status='captured' where id=$1`,[r.inbound_id]),/social_reexecution_requires_review/);
      await receive(f);await work();assert.equal((await process(f)).status,'not_claimed');
      assert.equal(models.length,n+1);assert.equal(sends.length,m);
    });
    await check('crash before model + concurrent recovery: one second attempt, stale token fenced',async()=>{
      const f=fixture();await receive(f);await processCommercialQueueOne(admin,{env});const r=await route(f);
      const args={p_lane:'SALES',p_inbound:r.inbound_id,p_enabled:true};
      const first=(await admin.rpc('claim_respond_execution_v1',args)).data;assert.equal(first.authorized,true);
      await db.query("update respond_commercial_executions set lease_until=now()-interval '1 second' where inbound_id=$1",[r.inbound_id]);
      const n=models.length,m=sends.length;
      const recovered=await Promise.all([recover(),recover(second)]);
      assert.equal(models.length,n+1,JSON.stringify({recovered,journal:await journal(f)}));assert.equal(sends.length,m+1);assert.equal((await journal(f)).attempts,2);
      const stale=await admin.rpc('step_respond_execution_v1',{p_inbound:r.inbound_id,p_token:first.token,p_action:'model'});
      assert.equal(stale.data.allowed,false);
    });
    for(const lane of Object.keys(cases))await check(`${lane}: #168 intervenes between attempts, no model/send`,async()=>{
      const f=fixture(lane);await receive(f);modelStatus='failed';await work();modelStatus='idle';await human(f);await ready(f);
      const n=models.length,m=sends.length;await recover();assert.equal((await journal(f)).state,'paused');
      assert.equal(models.length,n);assert.equal(sends.length,m);
    });
    await check('two confirmed model failures exhaust to visible terminal review; no loop',async()=>{
      const f=fixture();await receive(f);modelStatus='failed';await work();await ready(f);await recover();modelStatus='idle';
      const e=await journal(f);assert.equal(e.state,'review_required');assert.equal(e.reason,'attempts_exhausted');assert.equal(e.attempts,2);
      const n=models.length;await ready(f);await recover();await process(f);assert.equal(models.length,n);
      assert.equal(e.audit.filter(a=>a.action==='model_failed').length,2,'failure evidence retained');
    });
    for(const [status,code] of [['processing','dispatch_started'],['sent',null],['failed','respond_delivery_unknown'],['processing','human_guard_pending']])
      await check(`reserved outbound ${status}/${code}: zero recovery; existing evidence immutable`,async()=>{
        const f=fixture();await receive(f);modelStatus='failed';await work();modelStatus='idle';const r=await route(f);
        const run=(await service.query("insert into sales_agent_v2_shadow_runs(inbound_message_id,session_id,status,called_tools,proposed_response) values($1,$2,'idle','[]',$3) returning id",[r.inbound_id,prefix+'-reserved',output])).rows[0];
        await service.query("insert into sales_agent_v2_auto_outbound(inbound_message_id,shadow_run_id,respond_contact_id,channel_id,case_kind,status,error_code,proposed_message) values($1,$2,$3,'497382','greeting_qualification',$4,$5,$6)",[r.inbound_id,run.id,f.event.respondContactId,status,code,output]);
        const read=async()=>(await service.query('select * from sales_agent_v2_auto_outbound where inbound_message_id=$1',[r.inbound_id])).rows[0];
        const before=await read(),n=models.length,m=sends.length;await ready(f);await recover();
        assert.equal((await journal(f)).reason,'existing_effect');assert.equal(models.length,n);assert.equal(sends.length,m);assert.deepEqual(await read(),before);
      });
    for(const lane of Object.keys(cases))await check(`${lane}: crash after model/tools fence never authorizes another model`,async()=>{
      for(const phase of ['model','tools']){
        const f=fixture(lane);await receive(f);await processCommercialQueueOne(admin,{env});const r=await route(f);
        const c=(await admin.rpc('claim_respond_execution_v1',{p_lane:lane,p_inbound:r.inbound_id,p_enabled:true})).data;
        assert.equal(c.authorized,true);
        const args={p_inbound:r.inbound_id,p_token:c.token};
        assert.equal((await admin.rpc('step_respond_execution_v1',{...args,p_action:'model'})).data.allowed,true);
        if(phase==='tools')assert.equal((await admin.rpc('step_respond_execution_v1',{...args,p_action:'tools'})).data.allowed,true);
        await db.query("update respond_commercial_executions set lease_until=now()-interval '1 second' where inbound_id=$1",[r.inbound_id]);
        const n=models.length,m=sends.length;await recover();
        assert.equal((await journal(f)).state,'review_required');assert.equal(models.length,n);assert.equal(sends.length,m);
      }
    });
    await check('expired queue lease after dispatch_started cannot duplicate a pending/uncertain send',async()=>{
      const f=fixture();await receive(f);let entered,release;
      const started=new Promise(ok=>entered=ok),held=new Promise(ok=>release=ok);
      sendHook=async()=>{entered();await held;throw Error('respond_delivery_unknown');};
      const run=work();await started;const n=sends.length,m=models.length;
      const r=await route(f);
      const out=(await service.query('select status,error_code from sales_agent_v2_auto_outbound where inbound_message_id=$1',[r.inbound_id])).rows[0];
      assert.equal(out.error_code,'dispatch_started');
      await db.query("update respond_commercial_executions set lease_until=now()-interval '1 second' where inbound_id=$1",[r.inbound_id]);
      await recover(second);assert.equal((await journal(f)).state,'review_required');
      const job=(await service.query('select state,lease_until from respond_commercial_jobs where event_id=$1',[f.event.eventId])).rows[0];
      assert.equal(job.state,'complete');assert.equal(job.lease_until,null);
      // Even a stale lease timestamp cannot reopen a terminal capture job.
      await db.query("update respond_commercial_jobs set lease_until=now()-interval '1 second' where event_id=$1",[f.event.eventId]);
      await receive(f);assert.equal((await work(second)).status,'idle');await process(f);
      assert.equal(models.length,m);assert.equal(sends.length,n);release();await run;sendHook=async()=>{};
      const uncertain=(await service.query('select * from sales_agent_v2_auto_outbound where inbound_message_id=$1',[r.inbound_id])).rows[0];
      assert.notEqual(uncertain.status,'sent');assert.equal(uncertain.error_code,'respond_delivery_unknown');
      await receive(f);await work();await process(f);
      await outbound.processSalesAutoOutboundRun(admin,uncertain.shadow_run_id,{env});
      assert.equal(sends.length,n);assert.equal(models.length,m);
      assert.deepEqual((await service.query('select * from sales_agent_v2_auto_outbound where inbound_message_id=$1',[r.inbound_id])).rows[0],uncertain);
    });
    await check("no handoff/cita effects created by retries",async()=>{
      for(const table of ['sales_agent_v2_handoffs','legal_agent_v1_handoffs'])
        assert.equal((await service.query(`select count(*)::int n from ${table} where respond_contact_id like $1`,[prefix+'%'])).rows[0].n,0);
      assert.equal((await service.query("select count(*)::int n from respond_appointment_sync where respond_contact_id like $1",[prefix+'%'])).rows[0].n,0);
    });
    return {result:recoveryGaps.length?'BLOCKED_SCENARIO_5':'PASS',checks,timingsMs:timings,latency,recoveryGaps,
      modelCalls:models.length,interceptedSends:sends.length,externalCalls:0,prefix};
  } finally {
    await new Promise(ok=>server.close(ok));
    globalThis.fetch=originalFetch;
    // Exact unique synthetic namespace only. Keep this manifest if cleanup fails.
    await db.query("delete from respond_commercial_executions where respond_contact_id like $1",[prefix+'%']);
    for(const lane of ['sales_agent_v2','owner_agent_v1','legal_agent_v1']){
      await db.query(`delete from ${lane}_auto_outbound where respond_contact_id like $1`,[prefix+'%']);
      await db.query(`delete from ${lane==='sales_agent_v2'?lane+'_shadow_runs':lane+'_runs'} where inbound_message_id in(select id from ${lane}_inbound_messages where respond_contact_id like $1)`,[prefix+'%']);
      await db.query(`delete from ${lane}_inbound_messages where respond_contact_id like $1`,[prefix+'%']);
    }
    await db.query("delete from respond_commercial_jobs where respond_contact_id like $1",[prefix+'%']);
    await db.query("delete from social_capture_receipts where respond_contact_id like $1",[prefix+'%']);
    await db.query("delete from social_message_routes where respond_contact_id like $1",[prefix+'%']);
    await db.query("delete from gv_respond_webhook_events where respond_contact_id like $1",[prefix+'%']);
    const remaining=(await db.query("select count(*)::int n from gv_respond_webhook_events where respond_contact_id like $1",[prefix+'%'])).rows[0].n;
    assert.equal(remaining,0);await saveManifest({prefix,cleanup:0});
  }
}
