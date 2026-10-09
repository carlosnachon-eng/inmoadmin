import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,createHash,createHmac,randomUUID} from 'node:crypto';
import {runManualReply,validManualText} from '../lib/messaging/metaAdminInbox/manual.js';
import {createManualHandler} from '../lib/messaging/metaAdminInbox/manualApi.js';
import {shadowOnceGate} from '../lib/messaging/metaAdminCapture/shadowOnce.js';
import {createShadowOnceSupabaseStore} from '../lib/messaging/metaAdminCapture/shadowOnceSupabase.js';
const inputId=randomUUID(),actor={id:randomUUID(),active:true,role_id:'admin'};
const env={META_ADMIN_MANUAL_REPLY_ENABLED:'true',META_ADMIN_OUTBOUND_ACCESS_TOKEN:'synthetic',META_ADMIN_CAPTURE_ENCRYPTION_KEY:'a'.repeat(64),META_ADMIN_CAPTURE_HMAC_KEY:'b'.repeat(64)};
const from='5212220000000',waba='1297760461811288',phone='1198305790026665',event='fixture';
const subject=createHmac('sha256',Buffer.from(env.META_ADMIN_CAPTURE_HMAC_KEY,'hex')).update(`${waba}:${phone}:${from}`).digest('hex');
const c=createCipheriv('aes-256-gcm',Buffer.from(env.META_ADMIN_CAPTURE_ENCRYPTION_KEY,'hex'),Buffer.alloc(12,1));c.setAAD(Buffer.from(`${waba}:${phone}:${event}`));
const data=Buffer.concat([c.update(from),c.final()]).toString('hex');
const envelope={input:{id:inputId,waba_id:waba,phone_number_id:phone,subject_ref:subject,native_message_id:'wamid.synthetic'},
 sender_ciphertext:{v:1,iv:Buffer.alloc(12,1).toString('hex'),tag:c.getAuthTag().toString('hex'),data},event_key:event,sender_ref:subject,sender_evidence:'signed_from',
 exact_phone_digest:createHash('sha256').update('522220000000').digest('hex')};
function harness(){
 const actions=new Set();let paused=false,calls=0,finished;
 return {get paused(){return paused;},get calls(){return calls;},get finished(){return finished;},
  store:{load:async()=>structuredClone(envelope),reserve:async a=>{if(actions.has(a.actionId))return false;actions.add(a.actionId);paused=true;return true;},start:async()=>true,finish:async(a,r)=>{finished=r;return true;}},
  fetchImpl:async(url,options)=>{assert.equal(paused,true);calls++;assert.equal(JSON.parse(options.body).to,from);assert.equal(options.redirect,'error');return {ok:true,json:async()=>({messages:[{id:'wamid.result'}]})};}};
}
const args=h=>({inputId,actionId:randomUUID(),text:'Recibimos tu mensaje.',actor,env,store:h.store,fetchImpl:h.fetchImpl});
test('one manual accepted request pauses before transport; unmatched needs no private context',async()=>{const h=harness();assert.equal((await runManualReply(args(h))).status,'accepted');assert.equal(h.calls,1);assert.equal(h.finished.wamid,'wamid.result');});
test('double click / two concurrent invocations with same action: exactly one HTTP',async()=>{const h=harness(),a=args(h);const results=await Promise.all([runManualReply(a),runManualReply(a)]);assert.equal(results.filter(r=>r.status==='accepted').length,1);assert.equal(h.calls,1);});
test('uncertain transport consumes action and keeps pause; replay sends zero',async()=>{const h=harness(),a=args(h);a.fetchImpl=async()=>{throw Error('synthetic timeout');};assert.equal((await runManualReply(a)).status,'uncertain');assert.equal(h.paused,true);assert.equal((await runManualReply(a)).status,'already_consumed_or_blocked');});
test('failed Meta response has no retry and remains paused',async()=>{const h=harness(),a=args(h);a.fetchImpl=async()=>({ok:false,status:400,json:async()=>({error:{code:100}})});assert.equal((await runManualReply(a)).status,'failed');assert.equal(h.paused,true);});
test('finish persistence failure => uncertain, no retry',async()=>{const h=harness();h.store.finish=async()=>{throw Error('storage');};assert.equal((await runManualReply(args(h))).status,'uncertain');assert.equal(h.calls,1);});
test('internal/unverified subject denied by durable evidence load',async()=>{const h=harness();h.store.load=async()=>null;assert.equal((await runManualReply(args(h))).status,'blocked');assert.equal(h.calls,0);assert.equal(h.paused,false);});
test('recipient cipher mismatch blocks before reservation',async()=>{const h=harness();h.store.load=async()=>({...envelope,sender_ref:'wrong'});assert.equal((await runManualReply(args(h))).status,'blocked');assert.equal(h.paused,false);});
test('unauthorized actor or flag OFF never send',async()=>{const h=harness();assert.equal((await runManualReply({...args(h),actor:{...actor,active:false}})).status,'blocked');assert.equal((await runManualReply({...args(h),env:{...env,META_ADMIN_MANUAL_REPLY_ENABLED:'false'}})).status,'disabled');assert.equal(h.calls,0);});
test('strict plain sanitized text: empty, HTML, control, oversize denied',()=>{for(const t of ['',' ', '<b>Hola</b>','Hola\u202e','x'.repeat(2001)])assert.equal(validManualText(t),false);assert.equal(validManualText('Hola.\nGracias.'),true);});
test('manual pause blocks shadow independently of identity or echo',()=>{assert.equal(shadowOnceGate({manual_attention:true}).reason,'human_manual_reply');});
test('real snapshot adapter reads durable pause; missing evidence fails closed',async()=>{
 const store=createShadowOnceSupabaseStore({rpc:async name=>({data:name==='meta_admin_manual_attention_v1'?true:{input:{},subject_nodes:[],echo_roots:[]}})});
 assert.equal((await store.snapshot(inputId)).manual_attention,true);
 const unavailable=createShadowOnceSupabaseStore({rpc:async name=>name==='meta_admin_manual_attention_v1'?{error:true}:{data:{}}});
 await assert.rejects(()=>unavailable.snapshot(inputId));
});
const response=()=>({code:0,body:null,setHeader(){},status(n){this.code=n;return this;},json(b){this.body=b;return this;}});
test('API rejects client recipient/actor/scope injection and cross-origin',async()=>{
 let calls=0;const handler=createManualHandler({authorize:async()=>actor,store:()=>{calls++;return {};}});
 for(const extra of [{recipient:from},{actor_id:actor.id},{phone_number_id:phone}]){
  const r=response();await handler({method:'POST',query:{},headers:{origin:'https://example.test',host:'example.test'},body:{input_id:inputId,action_id:randomUUID(),text:'Hola',...extra}},r);assert.equal(r.code,400);
 }
 const r=response();await handler({method:'POST',query:{},headers:{origin:'https://evil.test',host:'example.test'},body:{}},r);assert.equal(r.code,403);
});
test('API cannot trust a client-provided profile',async()=>{const r=response();await createManualHandler({authorize:async()=>null,store:()=>{throw Error('must not construct');}})({method:'POST',body:{actor}},r);assert.equal(r.code,403);});
