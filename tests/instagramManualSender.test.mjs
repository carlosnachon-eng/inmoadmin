import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {encryptInstagramRecipient,decryptInstagramRecipient} from '../lib/messaging/instagram/manualRecipient.js';
import {runInstagramManualReply,sendInstagramTextOnce,instagramManualText} from '../lib/messaging/instagram/manualSender.js';
import {createInstagramManualHandler} from '../lib/messaging/instagram/manualApi.js';
import {createInstagramObserverHandler,normalizeInstagramObservations,instagramObserverConfig} from '../lib/messaging/instagram/observer.js';

const input='a'.repeat(64),recipient='900000001',account='17841440384433670';
const actor={id:randomUUID(),active:true,role_id:'admin'};
const env={VERCEL_ENV:'preview',APP_ENV:'preview',NEXT_PUBLIC_SUPABASE_URL:'https://hjfwjnejbcpmknvfpdcq.supabase.co',
 INSTAGRAM_MANUAL_REPLY_ENABLED:'true',INSTAGRAM_MANUAL_AUTHORIZED_INPUT:input,SOCIAL_INSTAGRAM_PAGE_ACCESS_TOKEN:'synthetic-secret',
 INSTAGRAM_MANUAL_RECIPIENT_KEY:'c'.repeat(64),INSTAGRAM_OBSERVER_HMAC_KEY:'b'.repeat(64),
 SOCIAL_OAUTH_APP_SECRET:'d'.repeat(32),INSTAGRAM_OBSERVER_VERIFY_TOKEN:'v'.repeat(32),
 INSTAGRAM_OBSERVER_ENABLED:'true',INSTAGRAM_OBSERVER_ACCOUNT_ID:account,INSTAGRAM_MANUAL_CAPTURE_ENABLED:'true'};
function evidence(){const row={observation_key:input,kind:'dm',native_id:'mid.synthetic',account_id:account,page_id:'119960324707764',
 subject_ref:createHmac('sha256',env.INSTAGRAM_OBSERVER_HMAC_KEY).update(JSON.stringify([account,recipient])).digest('hex'),
 provenance:'customer_inbound',relation_state:'exact_subject',occurred_at:new Date().toISOString()};
 return {...row,recipient_ciphertext:encryptInstagramRecipient(recipient,row,env)};}
function harness(){let reserved=false,paused=false,calls=0,result;const e=evidence();
 return {e,get calls(){return calls;},get paused(){return paused;},get result(){return result;},
 store:{load:async()=>e,reserve:async()=>{if(reserved)return false;reserved=true;paused=true;return true;},start:async()=>true,
 finish:async(a,r)=>{result=r;return true;}},
 fetchImpl:async(url,opts)=>{assert.equal(paused,true);calls++;assert.equal(url,'https://graph.facebook.com/v26.0/119960324707764/messages');
 assert.equal(opts.redirect,'error');assert.deepEqual(JSON.parse(opts.body),{recipient:{id:recipient},message:{text:'Recibimos tu mensaje.'},reply_to:{mid:'mid.synthetic'}});
 return {ok:true,json:async()=>({recipient_id:recipient,message_id:'mid.outbound'})};}};
}
const args=h=>({input,action:randomUUID(),text:'Recibimos tu mensaje.',actor,env,store:h.store,fetchImpl:h.fetchImpl});
test('manual DEV reply: pause precedes one POST; accepted is not delivered/read',async()=>{const h=harness();assert.deepEqual(await runInstagramManualReply(args(h)),{status:'accepted',paused:true});assert.equal(h.calls,1);assert.equal(h.result.message_id,'mid.outbound');});
test('double click and two action IDs on same authorized input: single dispatch',async()=>{const h=harness();const results=await Promise.all(Array.from({length:8},()=>runInstagramManualReply(args(h))));assert.equal(results.filter(x=>x.status==='accepted').length,1);assert.equal(h.calls,1);});
for(const patch of [{VERCEL_ENV:'production'},{APP_ENV:'production'},{NEXT_PUBLIC_SUPABASE_URL:'https://bnzrnizrmonjxlktbhlp.supabase.co'},
 {INSTAGRAM_MANUAL_AUTHORIZED_INPUT:'f'.repeat(64)},{SOCIAL_INSTAGRAM_PAGE_ACCESS_TOKEN:''},{INSTAGRAM_MANUAL_REPLY_ENABLED:'false'}])
 test(`DEV gate ${Object.keys(patch)[0]}`,async()=>{const h=harness();await runInstagramManualReply({...args(h),env:{...env,...patch}});assert.equal(h.calls,0);assert.equal(h.paused,false);});
for(const patch of [{kind:'comment'},{kind:'dm_echo'},{provenance:'unknown'},{relation_state:'unresolved'},{account_id:'other'},
 {page_id:'other'},{observation_key:'e'.repeat(64)},{native_id:'mid.tampered'},{subject_ref:'f'.repeat(64)},
 {recipient_ciphertext:null},{occurred_at:new Date(Date.now()-86400001).toISOString()},{occurred_at:'bad'}])
 test(`evidence gate ${Object.keys(patch)[0]} ${String(Object.values(patch)[0])}`,async()=>{const h=harness();Object.assign(h.e,patch);assert.equal((await runInstagramManualReply(args(h))).status,'blocked');assert.equal(h.calls,0);});
test('inactive or unauthorized actor cannot load or reserve',async()=>{for(const a of [{...actor,active:false},{...actor,role_id:'sales'}]){const h=harness();assert.equal((await runInstagramManualReply({...args(h),actor:a})).status,'blocked');assert.equal(h.calls,0);}});
test('ciphertext authenticated to input/subject/native id; no clear recipient',()=>{const e=evidence();assert.equal(decryptInstagramRecipient(e,env),recipient);assert.ok(!JSON.stringify(e).includes(recipient));assert.throws(()=>decryptInstagramRecipient({...e,native_id:'other'},env));assert.throws(()=>decryptInstagramRecipient(e,{...env,INSTAGRAM_MANUAL_RECIPIENT_KEY:'e'.repeat(64)}));});
for(const patch of [{app_id:'other'},{page_id:'other'},{account_id:'other'},{thread_ref:'f'.repeat(64)}])
 test(`binding tamper ${Object.keys(patch)[0]}`,()=>assert.throws(()=>decryptInstagramRecipient({...evidence(),...patch},env)));
test('text sanitized + byte bounded',()=>{for(const text of ['', ' x','<script>', '🙂'.repeat(251), 'a'.repeat(1000),'hi\u202e','a\nb'])assert.equal(instagramManualText(text),false);assert.equal(instagramManualText('Gracias por escribirnos.'),true);});
test('HTTP 403 terminal and sanitized; no retry',async()=>{const h=harness();let calls=0;const a={...args(h),fetchImpl:async()=>{calls++;return {ok:false,status:403,json:async()=>({error:{code:200,error_subcode:1,type:'OAuthException',message:`Missing permission ${recipient} synthetic-secret`,error_data:{details:'private@example.invalid'}}})};}};
 assert.equal((await runInstagramManualReply(a)).status,'failed');assert.equal(h.result.http_error.code,200);assert.ok(!JSON.stringify(h.result).includes(recipient));assert.ok(!JSON.stringify(h.result).includes('synthetic-secret'));assert.ok(!JSON.stringify(h.result).includes('example.invalid'));
 await runInstagramManualReply(a);assert.equal(calls,1);assert.equal(h.paused,true);});
for(const mode of ['timeout','5xx','invalid_json','wrong_recipient','bad_mid'])test(`${mode}: uncertain consumes action, retains pause`,async()=>{
 const h=harness();let calls=0;const a={...args(h),fetchImpl:async()=>{calls++;if(mode==='timeout')throw Error('timeout');return {ok:mode!=='5xx',status:503,json:async()=>{if(mode==='invalid_json')throw Error('parse');return mode==='5xx'?{error:{code:1}}:{recipient_id:mode==='wrong_recipient'?'other':recipient,message_id:mode==='bad_mid'?null:'mid.ok'};}};}};
 assert.equal((await runInstagramManualReply(a)).status,'uncertain');await runInstagramManualReply(a);assert.equal(calls,1);assert.equal(h.paused,true);
});
test('journal finish failure does not resend',async()=>{const h=harness();h.store.finish=async()=>{throw Error('db');};const a=args(h);assert.equal((await runInstagramManualReply(a)).status,'uncertain');await runInstagramManualReply(a);assert.equal(h.calls,1);});
test('start rejects: no dispatch; pause preserved',async()=>{const h=harness();h.store.start=async()=>false;assert.deepEqual(await runInstagramManualReply(args(h)),{status:'blocked',paused:true});assert.equal(h.calls,0);});
const res=()=>({setHeader(){},status(n){this.code=n;return this;},json(x){this.body=x;return this;}});
test('API rejects UI recipient/thread or query override',async()=>{let calls=0;const handler=createInstagramManualHandler({authorize:async()=>actor,store:()=>{calls++;return {};},env});
 for(const body of [{input,action:randomUUID(),text:'Hola',recipient:'1'},{input,action:randomUUID(),text:'Hola',thread:'x'}]){
 const r=res();await handler({method:'POST',headers:{origin:'https://dev.invalid',host:'dev.invalid'},body,query:{}},r);assert.ok([400,403].includes(r.code));}assert.equal(calls,0);});
test('capture future inbound encrypted; echo/comment cannot acquire target',()=>{
 const body={object:'instagram',entry:[{id:account,messaging:[{sender:{id:recipient},recipient:{id:account},timestamp:Date.now(),message:{mid:'mid.capture'}}]}]};
 const cfg=instagramObserverConfig(env),row=normalizeInstagramObservations(body,cfg).rows[0];assert.equal(decryptInstagramRecipient(row,env),recipient);
 assert.ok(!JSON.stringify(row).includes(recipient));const event=body.entry[0].messaging[0];[event.sender,event.recipient]=[event.recipient,event.sender];event.message.is_echo=true;
 assert.equal(normalizeInstagramObservations(body,cfg).rows[0].recipient_ciphertext,undefined);
});
test('capture enabled: bad HMAC never reaches database; old app secret rejected',async()=>{let calls=0;const handler=createInstagramObserverHandler({env:()=>env,getDb:()=>{calls++;}});const raw=Buffer.from('{}');
 const req={method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256','old-app-secret').update(raw).digest('hex')},async *[Symbol.asyncIterator](){yield raw;}};
 const r=res();await handler(req,r);assert.equal(r.code,401);assert.equal(calls,0);});
test('no WhatsApp fallback or model imports in sender',async()=>{const {readFile}=await import('node:fs/promises');const code=await readFile(new URL('../lib/messaging/instagram/manualSender.js',import.meta.url),'utf8');assert.ok(!code.includes('messaging_product'));assert.ok(!code.includes('openai'));});
