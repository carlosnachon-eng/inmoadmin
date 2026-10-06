// SQL connector relay, fixed DEV project in the driver. No .env/keys/provider
// access. Run only with a dedicated, empty DEV queue and no deployed consumer.
// Hosted fixtures use future debounce. Default recovery tests pause before
// publishing output. Full recovery uses stale test-clock runs excluded by the
// existing sender age gate; all provider IO is intercepted, never forwarded.
// PTY relay: use `stty -icanon -echo` before Node; canonical input can truncate
// JSON replies above the terminal line limit. This is harness IO only.
import assert from "node:assert/strict";
import readline from "node:readline";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { localPgAdapter } from "../tests/helpers/localPgAdapter.mjs";
import { importWithStubs } from "../tests/helpers/socialFixtures.mjs";
import { commercialEnvelope, processCommercialQueueOne } from "../lib/social/commercialQueue.js";
import { sanitizeShadowText } from "../lib/shadow/coordinator.js";
import { recoverCommercialExecutionOne } from "../lib/social/commercialExecution.js";
import * as salesSender from "../lib/agentsV2/salesAutoOutbound.js";
import * as salesHandoffs from "../lib/agentsV2/salesHandoff.js";

const fullRecovery=process.env.QUEUE_DEV_FULL_RECOVERY==='true';
const RealDate=Date;
// Test clock only. Future debounce quarantines inbound pollers; completed_at
// seven days old keeps idle runs outside the existing Sales sender's max age.
// DB clock/token/180s lease and every application guard remain unchanged.
if(fullRecovery)globalThis.Date=class extends RealDate{
  constructor(...args){super(...(args.length?args:[RealDate.now()-7*86400000]));}
  static now(){return RealDate.now()-7*86400000;}
};

const dir=process.env.QUEUE_DEV_EVIDENCE;
assert.ok(dir?.startsWith('/private/tmp/respond-durable-ack-cert.'));
const prefix='synthetic-q170-dev-'+randomUUID(),pending=new Map(),checks=[];let seq=0;
await writeFile(dir+'/dev-fixtures.json',JSON.stringify({prefix}),{mode:0o600});
const io=readline.createInterface({input:process.stdin});
io.on('line',line=>{if(!line.startsWith('DEV_RESULT:'))return;const r=JSON.parse(line.slice(11)),p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.reject(Object.assign(Error(r.error.message),{code:r.error.code})):p.resolve({rows:r.rows||[]});});
const remote=query=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});console.log('DEV_SQL:'+JSON.stringify({id,query}));});
const lit=v=>v==null?'null':typeof v==='number'?String(v):typeof v==='boolean'?String(v):"'"+(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")+"'";
const lanes=['sales_agent_v2','owner_agent_v1','legal_agent_v1'];
const quarantine=lanes.map(l=>`update public.${l}_inbound_messages set debounce_until='2099-01-01' where respond_contact_id like ${lit(prefix+'%')} and status='captured'`).join(';');
const client=role=>({async query(sql,args=[]){
  if(fullRecovery&&sql.startsWith('insert into public."sales_agent_v2_shadow_runs"')){
    const columns=sql.slice(sql.indexOf('(')+1,sql.indexOf(')')).split(',').map(x=>x.trim().replaceAll('"',''));
    assert.ok(RealDate.now()-RealDate.parse(args[columns.indexOf('completed_at')])>86400000,'hosted run must be stale to external sender');
  }
  let q=sql.replace(/\$(\d+)/g,(_,i)=>lit(args[Number(i)-1]));
  if(q.startsWith('select public."enqueue_respond_commercial_v1"'))q=`select set_config('queueqa.result',(${q.replace(/ as result$/,'')})::text,true);update public.gv_respond_webhook_events set status='processed',next_attempt_at='2099-01-01' where respond_contact_id like ${lit(prefix+'%')};select current_setting('queueqa.result')::jsonb as result`;
  if(q.startsWith('select public."capture_social_route_v1"'))q=`select set_config('queueqa.result',(${q.replace(/ as result$/,'')})::text,true);${quarantine};select current_setting('queueqa.result')::jsonb as result`;
  return remote(`begin;set local statement_timeout='20s';set local role ${role};${q};commit;`);
}});
const service=client('service_role'),db=client('postgres'),admin=localPgAdapter(service);
const env={SOCIAL_ROUTING_V1_ENABLED:'true',SALES_AGENT_V2_AUTO_SHADOW_ENABLED:'true',RESPOND_IO_TOKEN:'synthetic-intercepted-only',
  ...(fullRecovery?{SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED:'true',VERCEL_ENV:'production',SUPABASE_ENVIRONMENT:'production'}:{})};
let interceptedSends=0;
globalThis.fetch=async(url,options)=>{
  assert.ok(fullRecovery&&String(url).startsWith('https://api.respond.io/v2/contact/id:'+prefix)&&String(url).endsWith('/message'),'nonfixture IO forbidden');
  assert.equal(options.method,'POST');interceptedSends++;
  return{ok:true,json:async()=>({messageId:'intercepted-dev-'+randomUUID()})};
};
const forbidden=async()=>assert.fail('human pause must block before model/send');
let allowModel=false,modelStatus='failed',modelCalls=0,onModel=async()=>{};
const createModel=async()=>{assert.ok(allowModel,'unexpected model');modelCalls++;await onModel();return{id:'synthetic-dev-session'};};
const getModel=async()=>({id:'synthetic-dev-session',status:modelStatus});
const output=()=>"¿Cuál es tu presupuesto?";
const common={'../ejecutivo/respondSync':{readRespondMessages:async()=>({messages:[]}),respondMessageTimestamp:()=>null},'../shadow/coordinator':{sanitizeShadowText},'./agentUsage':{safeAgentUsage:async()=>({})}};
const salesRunner=await importWithStubs(new URL('../lib/agentsV2/runSalesShadowMessage.js',import.meta.url),{
  ...common,'./openaiSalesAgent':{assertSalesAgentV2ShadowEnvironment:()=>{},createSalesSession:createModel,getSalesSession:getModel,
    fulfillSalesActions:forbidden,salesSessionItems:async()=>[],salesAssistantOutput:output},
});
const sales=await importWithStubs(new URL('../lib/agentsV2/processSalesInbound.js',import.meta.url),{
  './runSalesShadowMessage':salesRunner,
  './salesHandoff':fullRecovery?salesHandoffs:{createSalesHandoffIfNeeded:forbidden,dispatchSalesHandoff:forbidden},
  './salesAutoOutbound':fullRecovery?salesSender:{processSalesAutoOutboundRun:forbidden},
  './agentUsage':{safeAgentUsage:async()=>({})},'./openaiSalesAgent':{salesAgentModel:()=>null},
});
const owner=await importWithStubs(new URL('../lib/agentsV2/processOwnerInbound.js',import.meta.url),{
  ...common,'./openaiOwnerAgent':{createOwnerSession:createModel,getOwnerSession:getModel,fulfillOwnerActions:forbidden,ownerOutput:output},
});
const legal=await importWithStubs(new URL('../lib/agentsV2/processLegalInbound.js',import.meta.url),{
  ...common,'./openaiLegalAgent':{createLegalSession:createModel,getLegalSession:getModel,fulfillLegal:forbidden,legalOutput:output},'./legalHandoff':{createAndDispatchLegalHandoff:forbidden},
});
const processors={SALES:sales.processSalesInboundById,OWNER:owner.processOwnerInboundById,LEGAL:legal.processLegalInboundById};
const test=async(name,fn)=>{await fn();checks.push(name);console.log('DEV_CHECK:'+name);};
let report;
try{
  assert.equal((await service.query('select count(*)::int n from respond_commercial_jobs')).rows[0].n,0,'DEV queue must be empty');
  const cases=[['SALES','Busco departamento en renta',sales.processSalesInboundById,lanes[0]],['OWNER','Soy propietario, quiero vender mi casa',owner.processOwnerInboundById,lanes[1]],['LEGAL','Qué incluye la póliza jurídica',legal.processLegalInboundById,lanes[2]]];
  for(const [lane,text,processor,table] of (process.env.QUEUE_DEV_RECOVERY_ONLY==='true'?[]:cases)){
    const event={eventId:prefix+'-'+lane,eventType:'message.received',respondContactId:prefix+'-'+lane,channelId:'497382',messageId:prefix+'-m-'+lane,eventOccurredAt:new Date().toISOString(),payloadMeta:{channel_id:'497382'}};
    const args={p_event:{event_id:event.eventId,event_type:event.eventType,respond_contact_id:event.respondContactId,channel_id:event.channelId,message_id:event.messageId,event_occurred_at:event.eventOccurredAt,payload_meta:event.payloadMeta},p_envelope:commercialEnvelope({message:{text}},event)};
    await test(lane+': atomic queue, receipt and duplicate',async()=>{
      const a=await admin.rpc('enqueue_respond_commercial_v1',args);assert.equal(a.error,null);assert.equal(a.data.durable,true);
      const b=await admin.rpc('enqueue_respond_commercial_v1',args);assert.equal(b.data.duplicate,true);
      const counts=(await service.query("select (select count(*) from respond_commercial_jobs where event_id=$1)::int jobs,(select count(*) from social_capture_receipts where source_event_id=$1)::int receipts",[event.eventId])).rows[0];assert.deepEqual(counts,{jobs:1,receipts:1});
    });
    await service.query("insert into gv_respond_webhook_events(event_id,event_type,respond_contact_id,event_occurred_at,payload_meta,status,next_attempt_at) values($1,'message.sent',$2,now(),'{\"sender_source\":\"user\"}','processed','2099-01-01')",[prefix+'-human-'+lane,event.respondContactId]);
    await test(lane+': worker crash/lease recovery → real route/input → same-cycle processor; #168 pause preserved',async()=>{
      const old=(await admin.rpc('claim_respond_commercial_v1',{})).data;assert.equal(old.event_id,event.eventId);
      assert.equal((await admin.rpc('claim_respond_commercial_v1',{})).data,null);
      await db.query("update respond_commercial_jobs set lease_until=now()-interval '1 second' where event_id=$1",[event.eventId]);
      // Skip only the quarantined debounce wait. No pause, claim or send guard
      // is mocked; all actual processors/RPCs operate on real DEV rows.
      const result=await processCommercialQueueOne(admin,{env,processors,sleep:async()=>{}});
      assert.equal(result.status,'complete');assert.equal(result.laneAttempted,true);
      assert.ok(['paused','skipped'].includes(result.laneStatus));
      assert.equal((await admin.rpc('finish_respond_commercial_v1',{p_event_id:event.eventId,p_token:old.claim_token,p_state:'complete'})).data.state,'lease_lost');
      const r=(await service.query('select destination,inbound_id from social_message_routes where source_event_id=$1',[event.eventId])).rows[0];assert.equal(r.destination,lane);
      const state=(await service.query(`select status from ${table}_inbound_messages where id=$1`,[r.inbound_id])).rows[0];assert.equal(state.status,'skipped');
      const p=await processor(admin,r.inbound_id,{env});assert.equal(p.status,'not_claimed');
      assert.equal((await service.query(`select count(*)::int n from ${table}_auto_outbound where respond_contact_id=$1`,[event.respondContactId])).rows[0].n,0);
      assert.equal((await admin.rpc('enqueue_respond_commercial_v1',args)).data.state,'complete');
      assert.equal((await processCommercialQueueOne(admin,{env,processors})).status,'idle');
    });
  }
  assert.equal(modelCalls,0);
  for(const [lane,text,processor,table] of cases){
    await test(lane+': real DEV failed-model journal → second attempt → '+(fullRecovery?'intercepted sent':'human pause before output')+'; duplicate inert',async()=>{
      const contact=prefix+'-retry-'+lane,eventId=contact+'-event';
      const event={eventId,eventType:'message.received',respondContactId:contact,channelId:'497382',messageId:contact+'-m',eventOccurredAt:new Date().toISOString()};
      const args={p_event:{event_id:eventId,event_type:event.eventType,respond_contact_id:contact,channel_id:'497382',message_id:event.messageId,event_occurred_at:event.eventOccurredAt,payload_meta:{channel_id:'497382'}},p_envelope:commercialEnvelope({message:{text}},event)};
      assert.equal((await admin.rpc('enqueue_respond_commercial_v1',args)).data.durable,true);
      allowModel=true;modelStatus='failed';onModel=async()=>{};const n=modelCalls;
      await processCommercialQueueOne(admin,{env,processors,sleep:async()=>{}});
      const read=async()=>(await service.query('select state,attempts,reason,inbound_id,audit from respond_commercial_executions where event_id=$1',[eventId])).rows[0];
      assert.equal((await read()).state,'retryable');assert.equal(modelCalls,n+1);
      await admin.rpc('enqueue_respond_commercial_v1',args);await processCommercialQueueOne(admin,{env,processors});assert.equal(modelCalls,n+1);
      await db.query("update respond_commercial_executions set next_attempt_at=now()-interval '1 second' where event_id=$1",[eventId]);
      modelStatus='idle';
      // Hosted DEV may have background senders. Before any idle run/output can
      // commit, establish real #168 proof. Never leave a sendable synthetic run.
      onModel=fullRecovery?async()=>{}:()=>service.query("insert into gv_respond_webhook_events(event_id,event_type,respond_contact_id,event_occurred_at,payload_meta,status,next_attempt_at) values($1,'message.sent',$2,now(),'{\"sender_source\":\"user\"}','processed','2099-01-01')",[contact+'-human',contact]);
      const beforeSends=interceptedSends;
      await recoverCommercialExecutionOne(admin,{env,processors});
      const e=await read();assert.equal(e.state,fullRecovery?'complete':'paused');assert.equal(e.attempts,2);assert.equal(modelCalls,n+2);
      assert.equal(interceptedSends-beforeSends,fullRecovery?1:0);
      assert.equal((await processor(admin,e.inbound_id,{env})).status,'not_claimed');
      assert.equal((await service.query(`select count(*)::int n from ${table+(lane==='SALES'?'_shadow_runs':'_runs')} where inbound_message_id=$1`,[e.inbound_id])).rows[0].n,fullRecovery?1:0);
      assert.equal((await service.query(`select count(*)::int n from ${table+'_auto_outbound'} where respond_contact_id=$1 and status='sent' and provider_message_id like 'intercepted-dev-%'`,[contact])).rows[0].n,fullRecovery?1:0);
      assert.equal((await admin.rpc('enqueue_respond_commercial_v1',args)).data.duplicate,true);
      await recoverCommercialExecutionOne(admin,{env,processors});
      assert.equal(modelCalls,n+2);assert.equal(interceptedSends-beforeSends,fullRecovery?1:0);
      allowModel=false;onModel=async()=>{};
    });
  }
  assert.equal((await service.query('select ((select count(*) from sales_agent_v2_handoffs where respond_contact_id like $1)+(select count(*) from legal_agent_v1_handoffs where respond_contact_id like $1))::int as n',[prefix+'%'])).rows[0].n,0);
  report={result:'PASS',project:'hjfwjnejbcpmknvfpdcq',checks,modelCalls,interceptedSends,realMessages:0,fullRecovery,
    limitations:['SQL relay exercises real DEV DB/RPC; it is not PostgREST/HTTP latency evidence.',fullRecovery?'Application test clock offset seven days; DB lease clock unchanged. Runs stale to external sender; inbound debounce quarantined. Only model/provider IO intercepted.':'Hosted recovery stops at a real human pause before publishing output.','Independent-connection concurrency and slow-model ACK certified in disposable PostgreSQL.']};
}catch(e){report={result:'FAIL',checks,error:e.message,code:e.code};process.exitCode=1;}
finally{
  await writeFile(dir+'/dev-result.json',JSON.stringify(report,null,2),{mode:0o600});
  const p=lit(prefix+'%');
  await db.query([`delete from sales_agent_v2_handoffs where respond_contact_id like ${p}`,`delete from legal_agent_v1_handoffs where respond_contact_id like ${p}`,
    ...lanes.map(l=>`delete from ${l}_auto_outbound where respond_contact_id like ${p}`),
    ...lanes.map(l=>`delete from ${l+(l==='sales_agent_v2'?'_shadow_runs':'_runs')} where inbound_message_id in(select id from ${l}_inbound_messages where respond_contact_id like ${p})`),
    `delete from respond_commercial_executions where respond_contact_id like ${p}`,
    ...lanes.map(l=>`delete from ${l}_inbound_messages where respond_contact_id like ${p}`),
    `delete from respond_commercial_jobs where respond_contact_id like ${p}`,`delete from social_capture_receipts where respond_contact_id like ${p}`,
    `delete from social_message_routes where respond_contact_id like ${p}`,`delete from gv_respond_webhook_events where respond_contact_id like ${p}`].join(';'));
  const tables=['respond_commercial_executions','respond_commercial_jobs','social_capture_receipts','social_message_routes','gv_respond_webhook_events','respond_ai_resumptions',...lanes.flatMap(l=>[l+'_inbound_messages',l+'_auto_outbound'])];
  const residues=(await db.query(tables.map(t=>`select '${t}' as object,count(*)::int n from ${t} where respond_contact_id like ${p}`).join(' union all '))).rows;
  assert.ok(residues.every(r=>r.n===0));await writeFile(dir+'/dev-cleanup.json',JSON.stringify(residues,null,2),{mode:0o600});
  console.log('DEV_REPORT:'+JSON.stringify(report));console.log('DEV_CLEANUP:0');globalThis.Date=RealDate;io.close();
}
