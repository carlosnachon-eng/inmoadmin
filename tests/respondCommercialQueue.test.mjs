import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialEnvelope,commercialQueueEligible,enqueueCommercialEvent,processCommercialQueueOne} from '../lib/social/commercialQueue.js';
import {resolvePublicPropertyReference} from '../lib/social/publicPropertyReference.js';
import {memoryDb,importWithStubs,response} from './helpers/socialFixtures.mjs';

const event={eventId:'synthetic-e',eventType:'message.received',respondContactId:'synthetic-c',channelId:'497382',messageId:'synthetic-m'};
test('envelope bounds/sanitizes text; retains lexical catalog ref and explicit attribution without raw URLs/attachments',async()=>{
  const envelope=commercialEnvelope({message:{text:'https://emporioinmobiliario.com.mx/propiedades/EMP-TEST123 contacto@example.invalid 2221234567',attachment:{url:'https://secret.invalid/token'}},source:{post_id:'post',metadata:{origin_kind:'dm',secret:'secret'}}},event);
  assert.doesNotMatch(JSON.stringify(envelope),/https:|contacto@|2221234567|secret|token/);
  assert.deepEqual(envelope.references,{hasLink:true,publicIds:['EMP-TEST123']});assert.equal(envelope.hasAttachment,true);
  const db=memoryDb({propiedades:[{id:'verified',public_id:'EMP-TEST123',status:'published'}]});
  assert.equal((await resolvePublicPropertyReference(db,envelope.text,null,envelope.references)).propertyId,'verified');
  for(const channelId of ['497382','497385','498219','515318'])assert.equal(commercialQueueEligible({...event,channelId}),true);
  assert.equal(commercialQueueEligible({...event,eventType:'message.sent'}),false);
});
test('durable acknowledgment rejects DB failure and malformed success',async()=>{
  for(const result of [{error:{code:'08006'}},{data:null},{data:{durable:false}}])
    await assert.rejects(enqueueCommercialEvent({rpc:async()=>result},{},event),/enqueue_failed/);
});
test('uncertain DB timeout is not a false durable ACK',async()=>{
  const start=Date.now();await assert.rejects(enqueueCommercialEvent({rpc:()=>new Promise(()=>{})},{},event),/timeout/);
  assert.ok(Date.now()-start<5000);
});
test('Social OFF never claims and missing claim proof fails closed',async()=>{
  assert.equal((await processCommercialQueueOne({rpc:()=>assert.fail()},{env:{}})).status,'disabled');
  await assert.rejects(processCommercialQueueOne({rpc:async()=>({error:{code:'42501'}})},{env:{SOCIAL_ROUTING_V1_ENABLED:'true'}}),/claim_failed/);
});
test('worker HTTP is CRON_SECRET protected and POST/GET only; no user trigger',async()=>{
  let calls=0;const processor=()=>assert.fail('HTTP test must not invoke a model');
  const mod=await importWithStubs(new URL('../pages/api/cron/respond-commercial-worker.js',import.meta.url),{
    '../../../lib/ejecutivo/workCenter':{getAdminSupabase:()=>({})},
    '../../../lib/agentsV2/processSalesInbound':{processSalesInboundById:processor},
    '../../../lib/agentsV2/processOwnerInbound':{processOwnerInboundById:processor},
    '../../../lib/agentsV2/processLegalInbound':{processLegalInboundById:processor},
    '../../../lib/social/commercialQueue.js':{processCommercialQueueOne:async(_db,{processors})=>{
      calls++;assert.deepEqual(processors,{SALES:processor,OWNER:processor,LEGAL:processor});
      return{status:'complete',laneAttempted:true,laneStatus:'processed'};
    }},
  });
  assert.equal(mod.config.maxDuration,180);
  const prior=process.env.CRON_SECRET;process.env.CRON_SECRET='synthetic-cron';
  try{
    for(const [method,authorization,status] of [['PUT','Bearer synthetic-cron',405],['GET','',401],['GET','Bearer wrong',401],['GET','Bearer synthetic-cron',200]]){
      const res=response();await mod.default({method,headers:{authorization}},res);assert.equal(res.statusCode,status);
    }
    assert.equal(calls,1,'worker does not start a second lane/model within the same runtime budget');
  }finally{if(prior===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=prior;}
});

test('only newly-created specialized input with confirmed finish may reach existing immediate dispatcher',async()=>{
  for(const [destination,created,inboundId,finish,expected] of [
    ['SALES',true,'i','complete',true],['OWNER',true,'i','complete',true],['LEGAL',true,'i','complete',true],
    ['SALES',false,'i','complete',false],['SALES',true,null,'complete',false],
    ['UNKNOWN',true,'i','complete',false],['HUMAN_REVIEW',true,null,'review_required',false],
    ['SALES',true,'i','lease_lost',false],['SALES',true,'i','pending',false],
  ]){
    const order=[];const route={handled:true,destination,created,inboundId};
    const mod=await importWithStubs(new URL('../lib/social/commercialQueue.js',import.meta.url),{
      './captureReceipt.js':{captureSocialRouteSafely:async()=>{order.push('capture');return route;}},
      './immediate.js':{processSocialRouteImmediate:async(_db,r)=>{assert.equal(r,route);order.push('lane');return{status:'sent'};}},
    });
    const db={rpc:async name=>{
      if(name==='claim_respond_commercial_v1')return{data:{envelope:{text:'synthetic'}}};
      assert.equal(name,'finish_respond_commercial_v1');order.push('finish');return{data:{state:finish}};
    }};
    const result=await mod.processCommercialQueueOne(db,{env:{SOCIAL_ROUTING_V1_ENABLED:'true'},processors:{}});
    assert.equal(Boolean(result.laneAttempted),expected);
    assert.deepEqual(order,expected?['capture','finish','lane']:['capture','finish']);
  }
});
