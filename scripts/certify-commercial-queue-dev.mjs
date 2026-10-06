// SQL connector relay, fixed DEV project in the driver. No .env/keys/provider
// access. Run only with a dedicated, empty DEV queue and no deployed consumer.
// Unpaused send/model paths are certified in disposable PG, NOT exposed to DEV
// background senders. DEV lane fixtures are human-paused before capture.
import assert from "node:assert/strict";
import readline from "node:readline";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { localPgAdapter } from "../tests/helpers/localPgAdapter.mjs";
import { importWithStubs } from "../tests/helpers/socialFixtures.mjs";
import { commercialEnvelope, processCommercialQueueOne } from "../lib/social/commercialQueue.js";
import { sanitizeShadowText } from "../lib/shadow/coordinator.js";

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
  let q=sql.replace(/\$(\d+)/g,(_,i)=>lit(args[Number(i)-1]));
  if(q.startsWith('select public."enqueue_respond_commercial_v1"'))q=`select set_config('queueqa.result',(${q.replace(/ as result$/,'')})::text,true);update public.gv_respond_webhook_events set status='processed',next_attempt_at='2099-01-01' where respond_contact_id like ${lit(prefix+'%')};select current_setting('queueqa.result')::jsonb as result`;
  if(q.startsWith('select public."capture_social_route_v1"'))q=`select set_config('queueqa.result',(${q.replace(/ as result$/,'')})::text,true);${quarantine};select current_setting('queueqa.result')::jsonb as result`;
  return remote(`begin;set local statement_timeout='20s';set local role ${role};${q};commit;`);
}});
const service=client('service_role'),db=client('postgres'),admin=localPgAdapter(service);
const env={SOCIAL_ROUTING_V1_ENABLED:'true',RESPOND_IO_TOKEN:'synthetic-intercepted-only'};
globalThis.fetch=async()=>assert.fail('ALL external/model/provider traffic forbidden in DEV certification');
const forbidden=async()=>assert.fail('human pause must block before model/send');
const common={'../ejecutivo/respondSync':{readRespondMessages:forbidden,respondMessageTimestamp:()=>null},'../shadow/coordinator':{sanitizeShadowText},'./agentUsage':{safeAgentUsage:forbidden}};
const salesRunner=await importWithStubs(new URL('../lib/agentsV2/runSalesShadowMessage.js',import.meta.url),{
  ...common,'./openaiSalesAgent':{assertSalesAgentV2ShadowEnvironment:()=>{},createSalesSession:forbidden,getSalesSession:forbidden,
    fulfillSalesActions:forbidden,salesSessionItems:forbidden,salesAssistantOutput:forbidden},
});
const sales=await importWithStubs(new URL('../lib/agentsV2/processSalesInbound.js',import.meta.url),{
  './runSalesShadowMessage':salesRunner,
  './salesHandoff':{createSalesHandoffIfNeeded:forbidden,dispatchSalesHandoff:forbidden},'./salesAutoOutbound':{processSalesAutoOutboundRun:forbidden},
  './agentUsage':{safeAgentUsage:async()=>({})},'./openaiSalesAgent':{salesAgentModel:()=>null},
});
const owner=await importWithStubs(new URL('../lib/agentsV2/processOwnerInbound.js',import.meta.url),{
  ...common,'./openaiOwnerAgent':{createOwnerSession:forbidden,getOwnerSession:forbidden,fulfillOwnerActions:forbidden,ownerOutput:forbidden},
});
const legal=await importWithStubs(new URL('../lib/agentsV2/processLegalInbound.js',import.meta.url),{
  ...common,'./openaiLegalAgent':{createLegalSession:forbidden,getLegalSession:forbidden,fulfillLegal:forbidden,legalOutput:forbidden},'./legalHandoff':{createAndDispatchLegalHandoff:forbidden},
});
const test=async(name,fn)=>{await fn();checks.push(name);console.log('DEV_CHECK:'+name);};
let report;
try{
  assert.equal((await service.query('select count(*)::int n from respond_commercial_jobs')).rows[0].n,0,'DEV queue must be empty');
  const cases=[['SALES','Busco departamento en renta',sales.processSalesInboundById,lanes[0]],['OWNER','Soy propietario, quiero vender mi casa',owner.processOwnerInboundById,lanes[1]],['LEGAL','Qué incluye la póliza jurídica',legal.processLegalInboundById,lanes[2]]];
  for(const [lane,text,processor,table] of cases){
    const event={eventId:prefix+'-'+lane,eventType:'message.received',respondContactId:prefix+'-'+lane,channelId:'497382',messageId:prefix+'-m-'+lane,eventOccurredAt:new Date().toISOString(),payloadMeta:{channel_id:'497382'}};
    const args={p_event:{event_id:event.eventId,event_type:event.eventType,respond_contact_id:event.respondContactId,channel_id:event.channelId,message_id:event.messageId,event_occurred_at:event.eventOccurredAt,payload_meta:event.payloadMeta},p_envelope:commercialEnvelope({message:{text}},event)};
    await test(lane+': atomic queue, receipt and duplicate',async()=>{
      const a=await admin.rpc('enqueue_respond_commercial_v1',args);assert.equal(a.error,null);assert.equal(a.data.durable,true);
      const b=await admin.rpc('enqueue_respond_commercial_v1',args);assert.equal(b.data.duplicate,true);
      const counts=(await service.query("select (select count(*) from respond_commercial_jobs where event_id=$1)::int jobs,(select count(*) from social_capture_receipts where source_event_id=$1)::int receipts",[event.eventId])).rows[0];assert.deepEqual(counts,{jobs:1,receipts:1});
    });
    await service.query("insert into gv_respond_webhook_events(event_id,event_type,respond_contact_id,event_occurred_at,payload_meta,status,next_attempt_at) values($1,'message.sent',$2,now(),'{\"sender_source\":\"user\"}','processed','2099-01-01')",[prefix+'-human-'+lane,event.respondContactId]);
    await test(lane+': worker crash/lease recovery → real route/input; #168 pause preserved',async()=>{
      const old=(await admin.rpc('claim_respond_commercial_v1',{})).data;assert.equal(old.event_id,event.eventId);
      assert.equal((await admin.rpc('claim_respond_commercial_v1',{})).data,null);
      await db.query("update respond_commercial_jobs set lease_until=now()-interval '1 second' where event_id=$1",[event.eventId]);
      assert.equal((await processCommercialQueueOne(admin,{env})).status,'complete');
      assert.equal((await admin.rpc('finish_respond_commercial_v1',{p_event_id:event.eventId,p_token:old.claim_token,p_state:'complete'})).data.state,'lease_lost');
      const r=(await service.query('select destination,inbound_id from social_message_routes where source_event_id=$1',[event.eventId])).rows[0];assert.equal(r.destination,lane);
      const p=await processor(admin,r.inbound_id,{env});assert.ok(p.status==='paused'||p.reason==='human_attention_active');
      assert.equal((await service.query(`select count(*)::int n from ${table}_auto_outbound where respond_contact_id=$1`,[event.respondContactId])).rows[0].n,0);
      assert.equal((await admin.rpc('enqueue_respond_commercial_v1',args)).data.state,'complete');
      assert.equal((await processCommercialQueueOne(admin,{env})).status,'idle');
    });
  }
  report={result:'PASS',project:'hjfwjnejbcpmknvfpdcq',checks,modelCalls:0,realMessages:0,
    limitations:['SQL relay exercises real DEV DB/RPC; it is not PostgREST/HTTP latency evidence.','Unpaused models/sends and slow-model HTTP ACK are certified separately in disposable real PostgreSQL with intercepted IO.']};
}catch(e){report={result:'FAIL',checks,error:e.message,code:e.code};process.exitCode=1;}
finally{
  await writeFile(dir+'/dev-result.json',JSON.stringify(report,null,2),{mode:0o600});
  const p=lit(prefix+'%');
  await db.query([...lanes.map(l=>`delete from ${l}_auto_outbound where respond_contact_id like ${p}`),
    ...lanes.map(l=>`delete from ${l}_inbound_messages where respond_contact_id like ${p}`),
    `delete from respond_commercial_jobs where respond_contact_id like ${p}`,`delete from social_capture_receipts where respond_contact_id like ${p}`,
    `delete from social_message_routes where respond_contact_id like ${p}`,`delete from gv_respond_webhook_events where respond_contact_id like ${p}`].join(';'));
  const tables=['respond_commercial_jobs','social_capture_receipts','social_message_routes','gv_respond_webhook_events','respond_ai_resumptions',...lanes.flatMap(l=>[l+'_inbound_messages',l+'_auto_outbound'])];
  const residues=(await db.query(tables.map(t=>`select '${t}' as object,count(*)::int n from ${t} where respond_contact_id like ${p}`).join(' union all '))).rows;
  assert.ok(residues.every(r=>r.n===0));await writeFile(dir+'/dev-cleanup.json',JSON.stringify(residues,null,2),{mode:0o600});
  console.log('DEV_REPORT:'+JSON.stringify(report));console.log('DEV_CLEANUP:0');io.close();
}
