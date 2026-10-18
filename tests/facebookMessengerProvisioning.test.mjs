import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPageToken,validatePageMetadata,provisionMessenger} from '../lib/messaging/facebook/messenger/provisioning.js';
import {open} from '../lib/messaging/facebook/messenger/crypto.js';
import {createMessengerSetupApi} from '../lib/messaging/facebook/messenger/setupApi.js';
import {createWebReceiver} from '../lib/messaging/facebook/messenger/webReceiver.js';
import {createHmac} from 'node:crypto';
const now=Date.now(),token='synthetic-page-token-123456789';
const c={connection:'11111111-1111-4111-8111-111111111111',app:'101',page:'202',version:'v26.0',secret:'a'.repeat(32),indexKey:'b'.repeat(64),dataKey:'c'.repeat(64),tokenKey:'d'.repeat(64)};
const metadata=()=>({is_valid:true,app_id:c.app,profile_id:c.page,type:'PAGE',scopes:['pages_messaging','pages_manage_metadata'],expires_at:0,data_access_expires_at:0});
const fake=(changes={})=>async(url,init)=>{
 assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(url.hostname,'graph.facebook.com');
 let body=url.pathname.endsWith('/debug_token')?{data:{...metadata(),...changes}}:url.pathname.endsWith('/me')?{id:c.page}:{data:[{id:c.app,subscribed_fields:['messages','message_echoes']}]};
 return {ok:true,status:200,json:async()=>body};
};
test('documented Page introspection and identity, subscription checks are exclusively read-only',async()=>{
 const r=await inspectPageToken(c,token,{fetchImpl:fake(),now});assert.equal(r.ok,true);assert.equal(r.inbound_ready,true);assert.equal(r.echo_ready,true);
 assert.equal(r.meta_non_expiring,true);assert.equal(r.valid_until,new Date(now+86400000).toISOString());assert.ok(!JSON.stringify(r).includes(token));
});
test('foreign app, foreign Page, USER/Instagram token, invalid token and missing scope rejected',()=>{
 for(const [patch,stage] of [[{app_id:'999'},'app_binding'],[{profile_id:'999'},'page_binding'],[{type:'USER'},'token_type'],[{is_valid:false},'token_invalid'],[{scopes:['instagram_business_manage_messages']},'permissions'],[{scopes:null},'scopes_shape']])assert.equal(validatePageMetadata(c,{...metadata(),...patch},now).stage,stage);
});
test('expiry unknown/expired and wrong granular Page target fail closed',()=>{
 for(const expires_at of [undefined,-1,'0',Math.floor(now/1000)-1])assert.equal(validatePageMetadata(c,{...metadata(),expires_at},now).ok,false);
 assert.equal(validatePageMetadata(c,{...metadata(),granular_scopes:[{scope:'pages_messaging',target_ids:['999']}]},now).stage,'permission_target');
 const r=validatePageMetadata(c,{...metadata(),expires_at:Math.floor(now/1000)+3600},now);assert.ok(Date.parse(r.valid_until)<now+86400000);
});
test('HTTP and thrown errors return sanitized diagnostics, never provider text or URL',async()=>{
 const http=await inspectPageToken(c,token,{fetchImpl:async()=>({ok:false,status:400,json:async()=>({error:{code:190,error_subcode:463,message:token}})})});
 assert.deepEqual(http,{ok:false,stage:'introspection',http_status:400,code:190,subcode:463});
 const thrown=await inspectPageToken(c,token,{fetchImpl:async()=>{throw Error(token);}});assert.ok(!JSON.stringify(thrown).includes(token));
});
test('missing subscription is not credential failure and never auto-subscribes',async()=>{
 const mock=fake();const r=await inspectPageToken(c,token,{fetchImpl:async(u,i)=>u.pathname.endsWith('subscribed_apps')?{ok:true,status:200,json:async()=>({data:[]})}:mock(u,i)});
 assert.equal(r.ok,true);assert.equal(r.inbound_ready,false);
});
test('provision encrypts token with generation/expiry binding and no sender control',async()=>{
 let row;const r=await provisionMessenger(c,{actor:{id:'admin'},token,fetchImpl:fake(),now,store:{credential:async()=>null,provision:async a=>{row=a;return true;}}});
 assert.equal(r.sender,'OFF');assert.equal(row.generation,1);assert.equal(open(c,'token',[1,row.valid_until],row.token_box),token);
 assert.ok(!JSON.stringify(row).includes(token));assert.ok(!JSON.stringify(r).includes(token));
 assert.throws(()=>open({...c,page:'999'},'token',[1,row.valid_until],row.token_box));
});
test('generation conflict never overwrites or retries',async()=>{
 let writes=0;const r=await provisionMessenger(c,{actor:{id:'admin'},token,fetchImpl:fake(),store:{credential:async()=>null,provision:async()=>{writes++;return false;}}});
 assert.equal(r.stage,'provision_conflict');assert.equal(writes,1);
});
test('health missing/corrupt credential never falls back to staging token',async()=>{
 for(const prior of [null,{generation:1,valid_until:'bad',token_box:{}}]){
 let calls=0;const r=await provisionMessenger(c,{actor:{id:'admin'},health:true,token,store:{credential:async()=>prior},fetchImpl:async()=>{calls++;}});
 assert.equal(r.ok,false);assert.equal(calls,0);
 }
});
const env={FACEBOOK_MESSENGER_ENABLED:'true',APP_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:'https://hjfwjnejbcpmknvfpdcq.supabase.co',
 FACEBOOK_MESSENGER_CONNECTION_ID:c.connection,FACEBOOK_MESSENGER_APP_ID:c.app,FACEBOOK_MESSENGER_PAGE_ID:c.page,FACEBOOK_MESSENGER_APP_SECRET:c.secret,
 FACEBOOK_MESSENGER_VERIFY_TOKEN:'e'.repeat(32),FACEBOOK_MESSENGER_INDEX_KEY:c.indexKey,FACEBOOK_MESSENGER_DATA_KEY:c.dataKey,FACEBOOK_MESSENGER_TOKEN_KEY:c.tokenKey};
test('setup API requires authenticated admin and same origin; rejects client token/recipient',async()=>{
 for(const [actor,body,origin,status] of [[null,{operation:'health'},'https://dev.test',403],[{active:true,role_id:'asesor'},{operation:'health'},'https://dev.test',403],[{active:true,role_id:'admin'},{operation:'health'},'https://evil.test',403],[{active:true,role_id:'admin'},{operation:'provision',token},'https://dev.test',400]]){
 let code;const res={setHeader(){},status(n){code=n;return this;},json(){},end(){}};
 await createMessengerSetupApi({authorize:async()=>actor,getDb:()=>{throw Error('must not touch DB');},env:()=>env})({method:'POST',body,headers:{host:'dev.test',origin,'x-forwarded-proto':'https'}},res);assert.equal(code,status);
 }
});
test('public DEV receiver challenge, raw HMAC, durable acknowledgement and failure closed',async()=>{
 let writes=0;const handler=createWebReceiver({env:()=>env,capture:async(_c,rows)=>{writes++;return {received:rows.length,inserted:rows.length};}});
 const base='https://example.test/webhook';
 assert.equal((await handler(new Request(`${base}?hub.mode=subscribe&hub.verify_token=${env.FACEBOOK_MESSENGER_VERIFY_TOKEN}&hub.challenge=123`))).status,200);
 assert.equal((await handler(new Request(`${base}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123`))).status,403);
 const raw=JSON.stringify({object:'page',entry:[{id:c.page,messaging:[{sender:{id:'303'},recipient:{id:c.page},timestamp:now,message:{mid:'mid.local',text:'Local only'}}]}]});
 const signature='sha256='+createHmac('sha256',c.secret).update(raw).digest('hex');
 const req=sig=>new Request(base,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':sig},body:raw});
 assert.equal((await handler(req('sha256='+'0'.repeat(64)))).status,401);assert.equal(writes,0);
 assert.equal((await handler(req(signature))).status,200);assert.equal(writes,1);
 const broken=createWebReceiver({env:()=>env,capture:async()=>{throw Error('db unavailable');}});
 assert.equal((await broken(req(signature))).status,503);
 const off=createWebReceiver({env:()=>({}),capture:async()=>{throw Error('unreachable');}});assert.equal((await off(req(signature))).status,404);
});
