import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DEV_INPUT,DEV_DB,MAIN_PROJECT,RECEIVER_PROJECT,signRelay,verifyRelay,relayEnabled,safeRelayResult,receiveManualRelay,createManualRelayClient} from '../lib/messaging/instagram/manualRelay.js';
import {encryptInstagramRecipient} from '../lib/messaging/instagram/manualRecipient.js';
const now=Date.parse('2026-10-12T07:00:00Z'),secret='ab'.repeat(32);
const actor={id:'e04ad988-7b62-49ee-9f70-184b31100519',active:true,role_id:'admin'};
const env={VERCEL_ENV:'preview',APP_ENV:'preview',VERCEL_PROJECT_ID:RECEIVER_PROJECT,NEXT_PUBLIC_SUPABASE_URL:DEV_DB,
  INSTAGRAM_MANUAL_RELAY_ENABLED:'true',INSTAGRAM_MANUAL_RELAY_SECRET:secret,INSTAGRAM_MANUAL_RELAY_EXPIRES_AT:new Date(now+3600000).toISOString(),
  INSTAGRAM_MANUAL_RECIPIENT_KEY:'cd'.repeat(32),INSTAGRAM_OBSERVER_HMAC_KEY:'fixture-only',INSTAGRAM_MANUAL_REPLY_ENABLED:'false'};
const body={v:1,op:'preflight',input:DEV_INPUT,actor:actor.id,action:null,text:null,issued_at:now};
const row={observation_key:DEV_INPUT,kind:'dm',provenance:'customer_inbound',relation_state:'exact_subject',
 account_id:'17841440384433670',page_id:'119960324707764',native_id:'fixture-message',occurred_at:new Date(now-60000).toISOString(),
 subject_ref:createHmac('sha256',env.INSTAGRAM_OBSERVER_HMAC_KEY).update(JSON.stringify(['17841440384433670','123456789'])).digest('hex')};
row.recipient_ciphertext=encryptInstagramRecipient('123456789',row,env);
function setup(overrides={}){return {body,signature:signRelay(body,secret),env,now:()=>now,loadActor:async()=>actor,
 store:{load:async()=>row,status:async()=>({status:'not_consumed'}),reserve:async()=>{throw Error('unexpected_write');}},...overrides};}
test('signed assertion valid, body tamper/expiry/future denied',()=>{
 const sig=signRelay(body,secret);assert.ok(verifyRelay(body,sig,secret,now));
 assert.equal(verifyRelay({...body,actor:'00000000-0000-0000-0000-000000000000'},sig,secret,now),false);
 assert.equal(verifyRelay(body,sig,secret,now+10001),false);assert.equal(verifyRelay(body,sig,secret,now-1),false);
});
test('production, foreign DB/project, missing secret, OFF and expired relay denied',()=>{
 for(const change of [{VERCEL_ENV:'production'},{NEXT_PUBLIC_SUPABASE_URL:'other'},{VERCEL_PROJECT_ID:MAIN_PROJECT},
 {INSTAGRAM_MANUAL_RELAY_SECRET:''},{INSTAGRAM_MANUAL_RELAY_ENABLED:'false'},{INSTAGRAM_MANUAL_RELAY_EXPIRES_AT:new Date(now-1).toISOString()}])
 assert.equal(relayEnabled({...env,...change},RECEIVER_PROJECT,now),false);
});
test('preflight decrypts exact binding with sender OFF and does not claim',async()=>{
 const r=await receiveManualRelay(setup());assert.equal(r.status,'ready');assert.equal(r.binding_verified,true);assert.equal(r.sender_enabled,false);
 assert.equal(JSON.stringify(r).includes('ciphertext'),false);assert.equal(JSON.stringify(r).includes('123456789'),false);
});
test('only active admin, never coordinator or asserted alternate actor',async()=>{
 for(const a of [{...actor,role_id:'coord_operaciones'},{...actor,active:false},{...actor,id:'00000000-0000-0000-0000-000000000000'}])
 assert.equal((await receiveManualRelay(setup({loadActor:async()=>a}))).status,'blocked');
});
test('tampered binding, stale inbound, consumed input fail closed',async()=>{
 assert.equal((await receiveManualRelay(setup({store:{load:async()=>({...row,native_id:'tampered'})}}))).status,'blocked');
 assert.equal((await receiveManualRelay(setup({store:{load:async()=>({...row,occurred_at:new Date(now-86400001).toISOString()})}}))).status,'blocked');
 assert.equal((await receiveManualRelay(setup({store:{load:async()=>row,status:async()=>({status:'accepted'})}}))).status,'already_consumed_or_blocked');
});
test('no arbitrary input/recipient/operation accepted',()=>{
 for(const b of [{...body,input:'00'.repeat(32)},{...body,recipient:'123'},{...body,op:'rpc'}])assert.throws(()=>signRelay(b,secret));
});
test('closed response projection strips upstream secrets/IDs/errors',()=>{
 assert.deepEqual(safeRelayResult({status:'accepted',token:'secret',message_id:'native',recipient:'123',ciphertext:'box'}),{status:'accepted'});
});
test('client rejects coordinator, foreign origin and recipient without relay call',async()=>{
 let calls=0;const res={setHeader(){},status(code){this.code=code;return this;},json(b){this.body=b;return b;}};
 const e={...env,VERCEL_PROJECT_ID:MAIN_PROJECT,VERCEL_URL:'dev.example'};
 const req={method:'POST',headers:{origin:'https://dev.example',host:'dev.example','content-type':'application/json'},query:{},body:{action:actor.id,text:'Hola'}};
 await createManualRelayClient({authorize:async()=>({...actor,role_id:'coord_operaciones'}),env:e,now:()=>now,fetchImpl:()=>calls++})(req,res);assert.equal(res.code,403);
 const h=createManualRelayClient({authorize:async()=>actor,env:e,now:()=>now,fetchImpl:()=>calls++});
 await h({...req,headers:{...req.headers,origin:'https://other'}},res);assert.equal(res.code,400);
 await h({...req,body:{...req.body,recipient:'123'}},res);assert.equal(res.code,400);assert.equal(calls,0);
});
test('relay send OFF performs zero dispatch',async()=>{
 const b={...body,op:'send',action:actor.id,text:'Respuesta DEV'};let calls=0;
 const r=await receiveManualRelay(setup({body:b,signature:signRelay(b,secret),fetchImpl:()=>calls++}));assert.equal(r.status,'disabled');assert.equal(calls,0);
});
