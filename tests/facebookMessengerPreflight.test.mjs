import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {captureMessenger} from '../lib/messaging/facebook/messenger/observer.js';
import {seal} from '../lib/messaging/facebook/messenger/crypto.js';
import {checkCanary,createMessengerPreflight} from '../lib/messaging/facebook/messenger/preflight.js';
const now=Date.now(), c={connection:'11111111-1111-4111-8111-111111111111',app:'101',page:'202',secret:'a'.repeat(32),indexKey:'b'.repeat(64),dataKey:'c'.repeat(64),tokenKey:'d'.repeat(64),senderEnabled:false};
const actor={id:'22222222-2222-4222-8222-222222222222',active:true,role_id:'admin'};
const raw=Buffer.from(JSON.stringify({object:'page',entry:[{id:c.page,messaging:[{sender:{id:'303'},recipient:{id:c.page},timestamp:now-1000,message:{mid:'mid.local',text:'local only'}}]}]}));
const e=captureMessenger(raw,'sha256='+createHmac('sha256',c.secret).update(raw).digest('hex'),c).rows[0];
const scope={connection:c.connection,actor:actor.id,input:e.event_ref,thread:e.thread_ref,until:now+3600000};
const k={app_id:c.app,page_id:c.page,token_type:'PAGE',generation:1,scopes:['pages_messaging'],verified_at:new Date(now-1000).toISOString(),valid_until:new Date(now+3600000).toISOString()};
k.token_box=seal(c,'token',[1,k.valid_until],'local-token-not-a-credential');
const run=(config=c,a=actor,event=e,credential=k)=>checkCanary(config,a,event,credential,{scope,now});
test('exact binding passes with sender OFF; no returned identifiers or credentials',()=>assert.deepEqual(run(),{status:'PASS'}));
test('operator, role, active state, connection and sender gate deny',()=>{
 for(const a of [{...actor,id:'other'},{...actor,role_id:'asesor'},{...actor,active:false}])assert.equal(run(c,a).status,'FAIL');
 for(const cc of [{...c,senderEnabled:true},{...c,connection:'other'}])assert.equal(run(cc).status,'FAIL');
});
test('wrong thread/input/provider/channel/message/app/page and timestamp blocked',()=>{
 for(const patch of [{thread_ref:'f'.repeat(64)},{event_ref:'f'.repeat(64)},{message_ref:'f'.repeat(64)},{provider:'instagram_login_business'},{channel:'instagram_dm'},{occurred_at:new Date(now-2000).toISOString()}])assert.equal(run(c,actor,{...e,...patch}).status,'FAIL');
 for(const patch of [{app:'999'},{page:'999'}])assert.equal(run({...c,...patch}).status,'FAIL');
});
test('tampered ciphertext and recipient HMAC mismatches blocked by sender validator',()=>{
 for(const field of ['iv','tag','data'])assert.equal(run(c,actor,{...e,recipient_box:{...e.recipient_box,[field]:'00'+e.recipient_box[field].slice(2)}}).status,'FAIL');
 for(const n of [{psid:'404',mid:'mid.local'},{psid:'303',mid:'mid.other'}])assert.equal(run(c,actor,{...e,recipient_box:seal(c,'recipient',[e.thread_ref,e.message_ref,e.event_ref,e.occurred_at],n)}).status,'FAIL');
});
test('missing permissions, expired credential/window and expiry block',()=>{
 assert.equal(run(c,actor,e,{...k,scopes:[]}).code,'credential_denied');
 assert.equal(run(c,actor,e,{...k,valid_until:new Date(now-1).toISOString()}).status,'FAIL');
 assert.equal(run(c,actor,{...e,occurred_at:new Date(now-24*3600000).toISOString()}).code,'window_denied');
 assert.equal(checkCanary(c,actor,e,k,{scope:{...scope,until:now},now}).status,'FAIL');
});
test('unauthorized endpoint never obtains DB or performs operations',async()=>{
 let calls=0;const handler=createMessengerPreflight({authorize:async()=>null,getDb:async()=>{calls++;throw Error('never');}});
 const res={setHeader(){},status(){return this},json(x){this.body=x;return this}};
 await handler({method:'POST',body:{},headers:{}},res);
 assert.deepEqual(res.body,{status:'FAIL',code:'request_denied'});assert.equal(calls,0);
});
test('authenticated API reads only fixed canary and returns no data',async()=>{
 const env={APP_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:'https://hjfwjnejbcpmknvfpdcq.supabase.co',FACEBOOK_MESSENGER_ENABLED:'true',FACEBOOK_MESSENGER_CONNECTION_ID:c.connection,FACEBOOK_MESSENGER_APP_ID:c.app,FACEBOOK_MESSENGER_PAGE_ID:c.page,FACEBOOK_MESSENGER_APP_SECRET:c.secret,FACEBOOK_MESSENGER_VERIFY_TOKEN:'e'.repeat(32),FACEBOOK_MESSENGER_INDEX_KEY:c.indexKey,FACEBOOK_MESSENGER_DATA_KEY:c.dataKey,FACEBOOK_MESSENGER_TOKEN_KEY:c.tokenKey};
 let calls=0;const db={rpc:async(name,args)=>{calls++;assert.equal(name,'fb_messenger_canary_preflight_v1');assert.equal(args.p_input,scope.input);return {data:{event:e,credential:k}};}};
 const req={method:'POST',body:{},headers:{origin:'https://local.test',host:'local.test'}};
 const res={setHeader(){},status(){return this},json(x){this.body=x;return this}};
 const make=a=>createMessengerPreflight({authorize:async()=>a,getDb:async()=>db,env:()=>env,scope,now:()=>now});
 await make(actor)(req,res);assert.deepEqual(res.body,{status:'PASS'});assert.equal(calls,1);
 await make({...actor,id:'other'})(req,res);assert.deepEqual(res.body,{status:'FAIL',code:'operator_denied'});assert.equal(calls,1);
 await make(actor)({...req,body:{input:'arbitrary'}},res);assert.equal(res.body.status,'FAIL');assert.equal(calls,1);
});
