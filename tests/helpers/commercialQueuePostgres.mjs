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

// Shared by disposable PostgreSQL and connected DEV. Only model/provider IO is
// intercepted; receiver, queue RPCs, routing, lane processors and #168 are real.
export async function certifyCommercialQueue({ db, service, other, saveManifest = async()=>{} }) {
  const prefix = "synthetic-q170-" + randomUUID();
  await saveManifest({ prefix });
  const checks=[], timings=[], sends=[], models=[];
  let hook=async()=>{};
  const env={SOCIAL_ROUTING_V1_ENABLED:"true",SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED:"true",
    SALES_AGENT_V2_AUTO_SHADOW_ENABLED:"true",RESPOND_IO_TOKEN:"synthetic-intercepted-only",
    SUPABASE_ENVIRONMENT:"production",VERCEL_ENV:"production"};
  const admin=localPgAdapter(service), second=localPgAdapter(other);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.ok(String(url).startsWith("https://api.respond.io/v2/contact/id:"+prefix),"nonfixture network forbidden");
    assert.ok(String(url).endsWith("/message"));assert.equal(options.method,"POST");
    sends.push({url,body:JSON.parse(options.body)});
    return {ok:true,json:async()=>({messageId:"intercepted-"+randomUUID()})};
  };
  const output="¿Cuál es tu presupuesto para el departamento en renta?";
  const create=async(args)=>{models.push(args);await hook();return{id:"synthetic-session"};};
  const common={"../ejecutivo/respondSync":{readRespondMessages:async()=>({messages:[]}),respondMessageTimestamp:r=>r.at},
    "../shadow/coordinator":{sanitizeShadowText},"./agentUsage":{safeAgentUsage:async()=>({})}};
  const salesRunner=await importWithStubs(new URL("../../lib/agentsV2/runSalesShadowMessage.js",import.meta.url),{
    ...common,"./openaiSalesAgent":{assertSalesAgentV2ShadowEnvironment:()=>{},createSalesSession:create,
      getSalesSession:async()=>({id:"synthetic-session",status:"idle"}),fulfillSalesActions:()=>assert.fail(),
      salesSessionItems:async()=>[],salesAssistantOutput:()=>output},
  });
  const sales=await importWithStubs(new URL("../../lib/agentsV2/processSalesInbound.js",import.meta.url),{
    ...common,"./runSalesShadowMessage":salesRunner,"./salesHandoff":handoffs,"./salesAutoOutbound":outbound,
    "./openaiSalesAgent":{salesAgentModel:()=>"synthetic"},
  });
  const owner=await importWithStubs(new URL("../../lib/agentsV2/processOwnerInbound.js",import.meta.url),{
    ...common,"./openaiOwnerAgent":{createOwnerSession:create,getOwnerSession:async()=>({id:"synthetic-session",status:"idle"}),
      fulfillOwnerActions:()=>assert.fail(),ownerOutput:async()=>output},
  });
  const legal=await importWithStubs(new URL("../../lib/agentsV2/processLegalInbound.js",import.meta.url),{
    ...common,"./openaiLegalAgent":{createLegalSession:create,getLegalSession:async()=>({id:"synthetic-session",status:"idle"}),
      fulfillLegal:()=>assert.fail(),legalOutput:async()=>output},"./legalHandoff":{createAndDispatchLegalHandoff:()=>assert.fail()},
  });
  const processors={SALES:sales.processSalesInboundById,OWNER:owner.processOwnerInboundById,LEGAL:legal.processLegalInboundById};
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
    });
    await check("atomic ACK and crash after 200 recovered by fresh worker",async()=>{
      const f=fixture();const {res,ms}=await receive(f);assert.equal(res.statusCode,200);assert.ok(ms<5000);timings.push(ms);
      assert.equal(await route(f),undefined);assert.equal(models.length,0);assert.equal(sends.length,0);
      assert.equal((await processCommercialQueueOne(second,{env})).status,"complete");
      assert.equal((await route(f)).destination,"SALES");
      await process(f);assert.equal(sends.length,1);
      const before=models.length;await receive(f);await process(f);assert.equal(models.length,before);assert.equal(sends.length,1);
    });
    await check("slow model (5.5s) cannot delay another HTTP ACK",async()=>{
      const slow=fixture();await enqueue(slow);await processCommercialQueueOne(admin,{env});
      let started;const entered=new Promise(ok=>started=ok);hook=async()=>{started();await new Promise(ok=>setTimeout(ok,5500));};
      const run=process(slow);await entered;
      const f=fixture();const {res,ms}=await receive(f);assert.equal(res.statusCode,200);assert.ok(ms<5000);timings.push(ms);
      await run;hook=async()=>{};await processCommercialQueueOne(admin,{env});await process(f);
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
      await Promise.all([processCommercialQueueOne(admin,{env}),processCommercialQueueOne(second,{env})]);
      const n=sends.length;await Promise.all([process(f),process(f)]);assert.equal(sends.length,n+1);
      const alias={...f,event:{...f.event,eventId:prefix+"-alias-"+randomUUID()}};
      assert.equal((await enqueue(alias)).duplicate,true);assert.equal((await processCommercialQueueOne(admin,{env})).status,"idle");
      const r=await route(f);assert.ok(r);
      assert.equal((await service.query("select count(*)::int n from respond_commercial_jobs where message_id=$1",[f.event.messageId])).rows[0].n,1);
    });
    await check("expired lease recovers; stale worker fenced after newer claim",async()=>{
      const f=fixture();await enqueue(f);const first=(await admin.rpc("claim_respond_commercial_v1",{})).data;
      await db.query("update respond_commercial_jobs set lease_until=now()-interval '1 second' where event_id=$1",[f.event.eventId]);
      await processCommercialQueueOne(second,{env});
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
      await assert.rejects(processCommercialQueueOne(broken,{env}),/finish_failed/);
      const id=(await route(f)).id;
      await db.query("update respond_commercial_jobs set lease_until=now()-interval '1 second' where event_id=$1",[f.event.eventId]);
      assert.equal((await processCommercialQueueOne(second,{env})).status,"complete");assert.equal((await route(f)).id,id);
    });
    for(const lane of Object.keys(cases))for(const channel of ["497382","497385","498219","515318"])
      await check(`${lane}/${channel}: capture → real processor → intercepted sent → duplicate no effect`,async()=>{
        const f=fixture(lane,channel);await receive(f);await processCommercialQueueOne(admin,{env});assert.equal((await route(f)).destination,lane);
        const n=sends.length;await process(f);assert.equal(sends.length,n+1);await receive(f);await process(f);assert.equal(sends.length,n+1);
      });
    for(const lane of Object.keys(cases))await check(`${lane}: #168 before model and between model/send; later inbound stays paused`,async()=>{
      const f=fixture(lane);await receive(f);await human(f);await processCommercialQueueOne(admin,{env});
      let n=models.length,m=sends.length;await process(f);assert.equal(models.length,n);assert.equal(sends.length,m);
      const later=fixture(lane,'497382',f.event.respondContactId);await receive(later);await processCommercialQueueOne(admin,{env});await process(later);
      assert.equal(models.length,n);assert.equal(sends.length,m);
      const during=fixture(lane);await receive(during);await processCommercialQueueOne(admin,{env});hook=()=>human(during);
      await process(during);hook=async()=>{};assert.equal(sends.length,m);
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
    await check("no handoff/cita effects created by retries",async()=>{
      for(const table of ['sales_agent_v2_handoffs','legal_agent_v1_handoffs'])
        assert.equal((await service.query(`select count(*)::int n from ${table} where respond_contact_id like $1`,[prefix+'%'])).rows[0].n,0);
      assert.equal((await service.query("select count(*)::int n from respond_appointment_sync where respond_contact_id like $1",[prefix+'%'])).rows[0].n,0);
    });
    return {result:'PASS',checks,timingsMs:timings,modelCalls:models.length,interceptedSends:sends.length,externalCalls:0,prefix};
  } finally {
    await new Promise(ok=>server.close(ok));
    globalThis.fetch=originalFetch;
    // Exact unique synthetic namespace only. Keep this manifest if cleanup fails.
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
