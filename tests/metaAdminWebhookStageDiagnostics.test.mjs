import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createMetaObserverHandler} from '../lib/messaging/metaObserver/receiver.js';
import {syntheticEnv,fixtures} from './fixtures/metaObserver.mjs';

const env={...syntheticEnv,META_ADMIN_WEBHOOK_DIAGNOSTICS_ENABLED:'true'};
function req(body=fixtures.inbound,signatureOk=true){
 const raw=Buffer.from(JSON.stringify(body));
 const signature='sha256='+createHmac('sha256',env.META_OBSERVER_APP_SECRET).update(raw).digest('hex');
 return {method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signatureOk?'sha256='+'0'.repeat(64):signature},
 async *[Symbol.asyncIterator](){yield raw;}};
}
function res(){return {setHeader(){},status(n){this.code=n;return this},json(v){this.data=v;return this}}}
function setup({optIn=true,error=false}={}){
 const log=[];
 const handler=createMetaObserverHandler({
 env:()=>({...env,...(!optIn?{META_ADMIN_WEBHOOK_DIAGNOSTICS_ENABLED:'false'}:{})}),
 log:code=>log.push(code),
 getDb:async()=>({rpc:async(name,args)=>error?{error:{message:'DO_NOT_LOG_SECRET'}}:
 {data:{durable:true,state:'observed',inserted:args.p_events.length,duplicates:0}}})
 });
 return {handler,log};
}
test('opt-in diagnostic uses fixed codes, no content or identifiers',async()=>{
 const x=setup();
 const out=res();
 await x.handler(req(fixtures.inbound,false),out);
 assert.equal(out.code,200);
 assert.deepEqual(x.log,['stage_persisted']);
 assert.ok(!JSON.stringify(x.log).includes('DO_NOT_LOG_SECRET'));
});
test('invalid signatures only emit allowlisted stage, no payload',async()=>{
 const x=setup();const out=res();await x.handler(req(fixtures.inbound,true),out);
 assert.equal(out.code,401);assert.deepEqual(x.log,['stage_signature_rejected']);
});
test('unknown WABA is rejected without logging identifiers',async()=>{
 const x=setup();const out=res();
 const body=JSON.parse(JSON.stringify(fixtures.inbound));body.entry[0].id='999999999999';
 await x.handler(req(body,false),out);
 assert.equal(out.code,403);assert.deepEqual(x.log,['stage_scope_rejected']);
});
test('persistence failure does not leak database detail',async()=>{
 const x=setup({error:true});const out=res();await x.handler(req(fixtures.inbound,false),out);
 assert.equal(out.code,503);
 assert.deepEqual(x.log,['persistence_failed','stage_persistence_rejected']);
});
test('default flag OFF emits no stage diagnostics',async()=>{
 const x=setup({optIn:false});const out=res();await x.handler(req(fixtures.inbound,false),out);
 assert.equal(out.code,200);assert.deepEqual(x.log,[]);
});
