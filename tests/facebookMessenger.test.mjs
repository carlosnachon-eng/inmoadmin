import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {createHmac,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {messengerConfig,PROVIDER} from '../lib/messaging/facebook/messenger/config.js';
import {captureMessenger} from '../lib/messaging/facebook/messenger/observer.js';
import {binding,recipient,open,seal,ref} from '../lib/messaging/facebook/messenger/crypto.js';
import {runManualReply,pageToken} from '../lib/messaging/facebook/messenger/manual.js';
import {createMessengerWebhook,createMessengerManualApi} from '../lib/messaging/facebook/messenger/api.js';

// Synthetic local-only fixtures. No real token, contact, Page or network dispatch.
const env={FACEBOOK_MESSENGER_ENABLED:'true',APP_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:'https://hjfwjnejbcpmknvfpdcq.supabase.co',
 FACEBOOK_MESSENGER_CONNECTION_ID:'11111111-1111-4111-8111-111111111111',FACEBOOK_MESSENGER_APP_ID:'101',FACEBOOK_MESSENGER_PAGE_ID:'202',
 FACEBOOK_MESSENGER_APP_SECRET:'a'.repeat(32),FACEBOOK_MESSENGER_VERIFY_TOKEN:'b'.repeat(32),
 FACEBOOK_MESSENGER_INDEX_KEY:'c'.repeat(64),FACEBOOK_MESSENGER_DATA_KEY:'d'.repeat(64),FACEBOOK_MESSENGER_TOKEN_KEY:'e'.repeat(64)};
const c=messengerConfig(env), now=Date.parse('2026-10-18T17:00:00.000Z');
test('Messenger production environment is isolated from shared APP_ENV',()=>{
 const prod={...env,APP_ENV:undefined,FACEBOOK_MESSENGER_ENV:'production',VERCEL_ENV:'production',FACEBOOK_MESSENGER_ROLLOUT:'closed_manual',NEXT_PUBLIC_SUPABASE_URL:'https://bnzrnizrmonjxlktbhlp.supabase.co'};
 assert.equal(messengerConfig(prod).senderEnabled,false);
 assert.throws(()=>messengerConfig({...prod,FACEBOOK_MESSENGER_ENV:'preview'}));
 assert.throws(()=>messengerConfig({...prod,NEXT_PUBLIC_SUPABASE_URL:env.NEXT_PUBLIC_SUPABASE_URL}));
 assert.throws(()=>messengerConfig({...prod,FACEBOOK_MESSENGER_ROLLOUT:undefined}));
});
const actor={id:'22222222-2222-4222-8222-222222222222',active:true,role_id:'asesor'};
const event={sender:{id:'303'},recipient:{id:c.page},timestamp:now-1000,message:{mid:'mid.synthetic-1',text:'Texto sintético local'}};
const envelope=(events=[event])=>({object:'page',entry:[{id:c.page,messaging:events}]});
const signature=raw=>'sha256='+createHmac('sha256',c.secret).update(raw).digest('hex');
const parse=payload=>{const raw=Buffer.from(JSON.stringify(payload));return captureMessenger(raw,signature(raw),c);};
const inbound=()=>parse(envelope()).rows[0];
const credential=()=>{
 const k={app_id:c.app,page_id:c.page,token_type:'PAGE',generation:1,scopes:['pages_messaging'],verified_at:new Date(now-1000).toISOString(),valid_until:new Date(now+3600000).toISOString()};
 return {...k,token_box:seal(c,'token',[k.generation,k.valid_until],'synthetic-local-token')};
};
function harness(options={}) {
 let claims=0,dispatches=0,fetches=0,outcome; const row=options.row||inbound(),k=options.credential||credential();
 const store={input:async()=>row,credential:async()=>k,
  reserve:async()=>{if(claims||options.reserveDenied)return false;claims++;return true;},
  start:async()=>{if(options.startDenied||dispatches)return false;dispatches++;return true;},
  finish:async(a,o)=>{outcome=o;return !options.finishDenied;}};
 const fetchImpl=async(url,init)=>{fetches++;assert.equal(new URL(url).host,'graph.facebook.com');assert.equal(new URL(url).pathname,`/v26.0/${c.page}/messages`);
  assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer synthetic-local-token');
  assert.deepEqual(JSON.parse(init.body),{messaging_type:'RESPONSE',recipient:{id:'303'},message:{text:'Respuesta local'}});
  if(options.throwFetch)throw Error('sensitive network text must not escape');
  return {ok:!options.httpError,status:options.httpError||200,json:async()=> options.response|| (options.httpError?{error:{code:190,error_subcode:463,message:'secret payload'}}:{recipient_id:'303',message_id:'mid.synthetic-out'})};};
 const body={action:randomUUID(),input:row.event_ref,text:'Respuesta local'};
 const run=overrides=>runManualReply({config:{...c,senderEnabled:true},actor,body,store,fetchImpl,now:()=>now,...overrides});
 return {run,body,store,counts:()=>({claims,dispatches,fetches}),outcome:()=>outcome};
}
test('default OFF, no Instagram credential fallback and absolute Production gate',()=>{
 assert.equal(messengerConfig({}),null);assert.equal(c.senderEnabled,false);
 for(const override of [{VERCEL_ENV:'production'},{NEXT_PUBLIC_SUPABASE_URL:'https://bnzrnizrmonjxlktbhlp.supabase.co'},
  {FACEBOOK_MESSENGER_APP_SECRET:undefined,INSTAGRAM_BUSINESS_INSTAGRAM_APP_SECRET:'a'.repeat(32)},
  {FACEBOOK_MESSENGER_DATA_KEY:c.indexKey}])assert.throws(()=>messengerConfig({...env,...override}));
});
test('exact raw HMAC including escaped Unicode, CRLF; tamper, parsed body and missing signature rejected',()=>{
 const raw=Buffer.from(JSON.stringify(envelope()).replace('Texto','\\u0054exto')+'\r\n');
 assert.equal(captureMessenger(raw,signature(raw),c).rows.length,1);
 for(const [body,sig] of [[Buffer.concat([raw,Buffer.from(' ')]),signature(raw)],[raw,undefined],[raw,'sha1='+ 'a'.repeat(40)],[envelope(),signature(raw)]]) assert.throws(()=>captureMessenger(body,sig,c));
});
test('encrypted exact recipient/content, stable event key and no native IDs/text in normalized rows',()=>{
 const e=inbound();assert.equal(recipient(c,e),'303');assert.equal(open(c,'content',binding(e),e.content_box).text,event.message.text);
 assert.equal(e.event_ref,inbound().event_ref);assert.notEqual(e.recipient_box.iv,inbound().recipient_box.iv);
 const serialized=JSON.stringify(e);for(const privateValue of ['mid.synthetic-1','Texto sintético local','"303"'])assert.ok(!serialized.includes(privateValue));
});
test('provider/page/app/connection/thread/message/time/ciphertext tamper cannot recover recipient',()=>{
 const e=inbound();
 for(const field of ['page','app','connection'])assert.throws(()=>recipient({...c,[field]:'999'},e));
 for(const patch of [{provider:'instagram_login_business'},{channel:'instagram_dm'},{thread_ref:'a'.repeat(64)},
  {message_ref:'b'.repeat(64)},{event_ref:'f'.repeat(64)},{occurred_at:new Date(now).toISOString()},
  {recipient_box:{...e.recipient_box,provider:'instagram_login_business'}},{recipient_box:{...e.recipient_box,tag:'0'.repeat(32)}}])assert.throws(()=>recipient(c,{...e,...patch}));
});
test('wrong Page, numeric PSID, wrong object and malformed batch rejected',()=>{
 for(const payload of [{...envelope(),object:'instagram'},envelope([{...event,sender:{id:303}}]),
  {object:'page',entry:[{id:'999',messaging:[event]}]},envelope([{...event,recipient:{id:'999'}}]),{object:'page',entry:[]}])assert.throws(()=>parse(payload));
});
test('echo is not inbound; unsupported attachment has no URL fetch or reply capability; feed is not DM',()=>{
 const echo=parse(envelope([{...event,sender:{id:c.page},recipient:{id:'303'},message:{...event.message,is_echo:true}}])).rows[0];
 assert.equal(echo.kind,'echo');assert.equal(echo.recipient_box,null);assert.throws(()=>recipient(c,echo));
 const media=parse(envelope([{...event,message:{mid:'mid.media',attachments:[{type:'image',payload:{url:'https://private.invalid'}}]}}])).rows[0];
 assert.equal(media.kind,'unsupported');assert.equal(media.recipient_box,null);assert.ok(!JSON.stringify(media).includes('private.invalid'));
 assert.equal(parse({object:'page',entry:[{id:c.page,changes:[{field:'feed'}]}]}).rows.length,0);
 assert.equal(parse(envelope([{...event,message:{mid:event.message.mid,is_deleted:true}}])).rows[0].kind,'deleted');
});
test('stale/wrong Page/wrong app/Instagram token/unverified/expired credentials fail closed',()=>{
 for(const patch of [{app_id:'999'},{page_id:'999'},{token_type:'USER'},{scopes:['instagram_business_manage_messages']},
  {verified_at:new Date(now-86400001).toISOString()},{verified_at:new Date(now+1).toISOString()},{valid_until:new Date(now).toISOString()}]) assert.throws(()=>pageToken(c,{...credential(),...patch},now));
});
test('one accepted dispatch, safe outcome ID encrypted, double click / new action cannot consume same inbound',async()=>{
 const h=harness();const r=await Promise.all([h.run(),h.run()]);
 assert.deepEqual(r.map(x=>x.status).sort(),['accepted','already_consumed_or_blocked']);
 assert.equal((await h.run({body:{...h.body,action:randomUUID()}})).status,'already_consumed_or_blocked');
 assert.deepEqual(h.counts(),{claims:1,dispatches:1,fetches:1});
 assert.equal(h.outcome().outbound_box.provider,PROVIDER);assert.ok(!JSON.stringify(r).includes('mid.synthetic-out'));
});
test('sender OFF, actor/recipient tamper, old input, DB gate all prevent network',async()=>{
 for(const override of [{config:c},{actor:{...actor,active:false}},{actor:{...actor,role_id:'unknown'}}]){
  const h=harness();await h.run(override);assert.equal(h.counts().fetches,0);
 }
 for(const extra of [{recipient:'303'},{thread:'a'.repeat(64)},{provider:'instagram_login_business'}]){
  const h=harness();assert.equal((await h.run({body:{...h.body,...extra}})).status,'blocked');assert.equal(h.counts().claims,0);
 }
 const old=harness();await old.run({now:()=>now+24*3600000});assert.equal(old.counts().claims,0);
 for(const options of [{reserveDenied:true},{startDenied:true}]){const h=harness(options);await h.run();assert.equal(h.counts().fetches,0);}
});
for(const options of [{httpError:400},{httpError:429},{httpError:500},{throwFetch:true},{response:{}},{response:{recipient_id:'999',message_id:'mid.bad'}},{finishDenied:true}]) {
 test(`terminal outcome without retries: ${JSON.stringify(options)}`,async()=>{
  const h=harness(options),r=await h.run();assert.ok(['failed','uncertain'].includes(r.status));
  await h.run();assert.equal(h.counts().fetches,1);assert.ok(!JSON.stringify(r).includes('secret'));
 });
}
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(v){this.body=v;return this;},end(){return this;},send(v){this.body=v;return this;}});
test('webhook challenge and persisted acknowledgement; storage failure never 200; sanitized diagnostics',async()=>{
 const logs=[];let calls=0;
 const getDb=()=>({rpc:async(name,args)=>{calls++;return {data:{received:args.p_rows.length,inserted:1}};}});
 const handler=createMessengerWebhook({env:()=>env,getDb,diagnostic:r=>logs.push(r)});
 const challenge=response();await handler({method:'GET',query:{'hub.mode':'subscribe','hub.verify_token':c.verify,'hub.challenge':'123'}},challenge);assert.equal(challenge.body,'123');assert.equal(calls,0);
 const raw=Buffer.from(JSON.stringify(envelope()));
 const request=()=>Object.assign(Readable.from([raw]),{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature(raw)}});
 const ok=response();await handler(request(),ok);assert.equal(ok.statusCode,200);assert.equal(calls,1);
 const bad=response();await createMessengerWebhook({env:()=>env,getDb:()=>{throw Error('secret');},diagnostic:r=>logs.push(r)})(request(),bad);assert.equal(bad.statusCode,503);
 assert.deepEqual(Object.keys(logs[0]),['stage','http_status']);assert.ok(!JSON.stringify(logs).includes(event.message.text));
});
test('manual API requires auth, origin; GET cannot send; OFF does not touch DB',async()=>{
 const handler=createMessengerManualApi({env:()=>env,authorize:async()=>null,getDb:()=>{throw Error('must not run');}});
 const r=response();await handler({method:'POST',headers:{}},r);assert.equal(r.statusCode,403);
 const get=response();await handler({method:'GET'},get);assert.equal(get.statusCode,405);
});
test('new routes are independent and Instagram Inbox remains untouched by adapter',()=>{
 const code=readFileSync(new URL('../lib/messaging/facebook/messenger/manual.js',import.meta.url),'utf8');
 assert.ok(!code.includes('graph.instagram.com'));assert.ok(!code.includes('metaAdminInbox'));
 const webhook=readFileSync(new URL('../pages/api/webhooks/facebook-messenger.js',import.meta.url),'utf8');assert.ok(webhook.includes('bodyParser:false'));
 const ui=readFileSync(new URL('../pages/administracion/inbox.js',import.meta.url),'utf8');assert.ok(ui.includes('<InstagramBusinessInbox/>'));
});
