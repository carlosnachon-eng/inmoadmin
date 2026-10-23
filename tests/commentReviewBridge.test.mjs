import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {bridgeHeaders,verifyBridge,readThroughBridge,BRIDGE_PATH,BRIDGE_BRANCH,DEV_URL} from '../lib/messaging/commentAgent/bridge.js';
import {createBridgeReceiver} from '../lib/messaging/commentAgent/bridgeReceiver.js';
import * as crypto from '../lib/messaging/instagram/business/crypto.js';
import {businessConfig} from '../lib/messaging/instagram/business/config.js';
import {evaluateInstagram} from '../lib/messaging/commentAgent/evaluateInstagram.js';
import {bridgeDiagnostic,safeBridgeDiagnostic} from '../lib/messaging/commentAgent/bridgeDiagnostic.js';
import {createBridgeWebReceiver} from '../lib/messaging/commentAgent/bridgeWebReceiver.js';
test('native Web Request retains signed whitespace and UTF-8, journals once, rejects tamper',async()=>{
 let requests=0;
 const fetchImpl=async(url)=>({ok:true,json:async()=>{
  if(url.endsWith('/user'))return{id:actor.id};if(url.includes('/profiles?'))return[actor];
  if(url.endsWith('/comment_bridge_request_v1')){requests++;return true;}
  if(url.endsWith('/ig_business_comments_v1'))return[];
  if(url.endsWith('/ig_business_token_v1'))return null;
  throw Error('unexpected');
 }});
 const handler=createBridgeWebReceiver({env,fetchImpl}),body='{\r\n  "op" : "evaluate"\r\n}';
 const headers={...bridgeHeaders(env,auth,Date.now(),'POST',body,randomUUID()),'content-type':'application/json'};
 const good=await handler(new Request('https://example.test'+BRIDGE_PATH,{method:'POST',headers,body}));
 assert.equal(good.status,200);assert.equal((await good.json()).status,'evaluated');assert.equal(requests,1);
 const bad=await handler(new Request('https://example.test'+BRIDGE_PATH,{method:'POST',headers,body:body+' '}));
 assert.equal(bad.status,403);assert.equal((await bad.json()).diagnostic.code,'bridge_signature');assert.equal(requests,1);
 const unicode=JSON.stringify({op:'approve',comment:'a'.repeat(64),revision:'b'.repeat(64),text:'Precio: información 🏡'});
 const signed=bridgeHeaders(env,auth,Date.now(),'POST',unicode,randomUUID());
 const noData=createBridgeWebReceiver({env,fetchImpl:async()=>{throw Error('stop after signature');}});
 const u=await noData(new Request('https://example.test'+BRIDGE_PATH,{method:'POST',headers:{...signed,'content-type':'application/json'},body:unicode}));
 assert.equal((await u.json()).diagnostic.stage,'identity');
});
test('bridge diagnostics reject arbitrary stages and sensitive exception values',()=>{
 assert.deepEqual(bridgeDiagnostic('body_read',Error('parsed_body')),{stage:'body_read',code:'parsed_body'});
 assert.equal(safeBridgeDiagnostic({stage:'body_read',code:'private credential'}),null);
 assert.deepEqual(bridgeDiagnostic('secret',Error('private credential')),{stage:'bridge_transport',code:'bridge_read_denied'});
});
const keys=generateKeyPairSync('ed25519');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:BRIDGE_BRANCH,NEXT_PUBLIC_SUPABASE_URL:DEV_URL,APP_ENV:'preview',
 COMMENT_REVIEW_BRIDGE_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}),COMMENT_REVIEW_BRIDGE_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'pem'}),
 SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',INSTAGRAM_BUSINESS_ENABLED:'true',INSTAGRAM_BUSINESS_MANUAL_SEND_ENABLED:'false',
 INSTAGRAM_BUSINESS_CONNECTION_ID:'00000000-0000-4000-8000-000000000001',INSTAGRAM_BUSINESS_APP_ID:'100',INSTAGRAM_BUSINESS_INSTAGRAM_APP_ID:'200',INSTAGRAM_BUSINESS_ACCOUNT_ID:'300',
 INSTAGRAM_BUSINESS_INSTAGRAM_APP_SECRET:'a'.repeat(32),INSTAGRAM_BUSINESS_VERIFY_TOKEN:'b'.repeat(32),INSTAGRAM_BUSINESS_INDEX_KEY:'c'.repeat(64),INSTAGRAM_BUSINESS_DATA_KEY:'d'.repeat(64),INSTAGRAM_BUSINESS_TOKEN_KEY:'e'.repeat(64),INSTAGRAM_BUSINESS_OAUTH_REDIRECT_URI:'https://example.test/setup',
 COMMENT_REVIEW_BRIDGE_URL:'https://emporio-instagram-observer-synthetic-carlosnachon-engs-projects.vercel.app'+BRIDGE_PATH};
const auth='Bearer synthetic.user.token',actor={id:'00000000-0000-4000-8000-000000000002',active:true,role_id:'admin'};
const req=()=>({method:'GET',url:BRIDGE_PATH,headers:bridgeHeaders(env,auth)});
test('signature binds user, method, exact path and time; rejects invalid and expired requests',()=>{
 const r=req();assert.equal(verifyBridge(r,env),'synthetic.user.token');
 for(const altered of [{...r,method:'POST'},{...r,url:BRIDGE_PATH+'?op=export'},{...r,headers:{...r.headers,authorization:'Bearer other'}},{...r,headers:{...r.headers,'content-length':'1'}},{...r,headers:{...r.headers,'transfer-encoding':'chunked'}},{...r,headers:{...r.headers,'x-review-signature':'0'.repeat(86)}}])assert.throws(()=>verifyBridge(altered,env));
 assert.throws(()=>verifyBridge(r,env,Date.now()+40000));
});
test('Production, other Supabase project, other branch and other keys fail closed',()=>{
 for(const e of [{...env,VERCEL_ENV:'production'},{...env,NEXT_PUBLIC_SUPABASE_URL:'https://production.test'},{...env,VERCEL_GIT_COMMIT_REF:'main'}])assert.throws(()=>bridgeHeaders(e,auth));
 assert.throws(()=>verifyBridge(req(),{...env,COMMENT_REVIEW_BRIDGE_PUBLIC_KEY:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})}));
});
async function run({profile=actor,rows=[],environment=env,request=req()}={}){
 const calls=[];const fetchImpl=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>url.endsWith('/user')?{id:actor.id}:url.includes('/profiles?')?[profile]:rows};};
 const res={setHeader(){},status(n){this.code=n;return this;},json(x){this.body=x;return this;}};
 await createBridgeReceiver({env:environment,fetchImpl})(request,res);return {res,calls};
}
test('authorized read uses verified user+role and only list RPC; no Meta or write calls',async()=>{
 const {res,calls}=await run();assert.equal(res.code,200);assert.equal(res.body.read_only,false);assert.equal(res.body.sender,false);assert.equal(calls.length,3);
 assert.ok(calls.every(x=>x.url.startsWith(DEV_URL+'/')));assert.equal(JSON.parse(calls[2].options.body).p_op,'list');
 assert.equal(calls[0].options.headers.Authorization,auth);assert.equal(calls[1].options.headers.Authorization,auth);
 assert.equal(JSON.stringify(res.body).includes('synthetic-service'),false);
});
const post=body=>{const rawBody=JSON.stringify(body);return{method:'POST',url:BRIDGE_PATH,rawBody,headers:{...bridgeHeaders(env,auth,Date.now(),'POST',rawBody,randomUUID()),'content-type':'application/json'}};};
test('runtime parsed body rejects before journal with exact sanitized stage',async()=>{
 const request=post({op:'evaluate'});delete request.rawBody;request.body={op:'evaluate'};
 const {res,calls}=await run({request});assert.equal(res.code,403);assert.equal(calls.length,0);
 assert.deepEqual(res.body.diagnostic,{stage:'body_read',code:'parsed_body'});
});
test('proxy preserves only allowlisted remote diagnostic, never upstream content',async()=>{
 const remote=async()=>({ok:false,json:async()=>({diagnostic:{stage:'body_read',code:'parsed_body'},secret:'never surface'})});
 await assert.rejects(readThroughBridge(env,auth,remote,'synthetic-oidc'),e=>e.diagnostic?.code==='parsed_body'&&!JSON.stringify(e).includes('never surface'));
});
test('signed operation rejects body tamper, publish, arbitrary fields, native IDs and missing nonce',()=>{
 const r=post({op:'evaluate'});assert.equal(verifyBridge(r,env),'synthetic.user.token');
 assert.throws(()=>verifyBridge({...r,rawBody:JSON.stringify({op:'approve'})},env));
 for(const body of [{op:'publish'},{op:'evaluate',platform:'facebook'},{op:'approve',comment:'123',revision:'a'.repeat(64),text:'test'}])assert.throws(()=>verifyBridge(post(body),env));
 assert.throws(()=>verifyBridge({...r,headers:{...r.headers,'x-review-nonce':''}},env));
});
test('Instagram property confirmation is signed exactly; no native IDs or implicit confirmation',()=>{
 const operation={op:'bind_property',comment:'a'.repeat(64),revision:'b'.repeat(64),property_public_id:'EMP-QA256',confirmed:true};
 assert.equal(verifyBridge(post(operation),env),'synthetic.user.token');
 for(const patch of [{confirmed:false},{comment:'123'},{connection:'other'},{platform:'facebook'},{property_public_id:'https://example.test'}])assert.throws(()=>verifyBridge(post({...operation,...patch}),env));
 const request=post(operation);request.rawBody=JSON.stringify({...operation,property_public_id:'EMP-OTHER'});
 assert.throws(()=>verifyBridge(request,env),/bridge_signature/);
});
test('write replay is consumed durably before evaluation; no token renewal or Meta writes',async()=>{
 const seen=new Set(),calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});let data;
  if(url.endsWith('/user'))data={id:actor.id};
  else if(url.includes('/profiles?'))data=[actor];
  else{const p=JSON.parse(options.body);
   if(url.endsWith('/comment_bridge_request_v1')){data=!seen.has(p.p_nonce);seen.add(p.p_nonce);}
   else if(url.endsWith('/ig_business_comments_v1'))data=[];
   else if(url.endsWith('/ig_business_token_v1')){assert.equal(p.p_op,'load');data=null;}
   else throw Error('unexpected');
  }return{ok:true,json:async()=>data};
 };
 const handler=createBridgeReceiver({env,fetchImpl}),request=post({op:'evaluate'}),res=()=>({setHeader(){},status(n){this.code=n;return this;},json(x){this.body=x;return this;}});
 const a=res();await handler(request,a);assert.equal(a.code,200);assert.equal(a.body.processed,0);
 const b=res();await handler(request,b);assert.equal(b.code,409);
 assert.equal(calls.filter(x=>x.url.endsWith('/ig_business_comments_v1')).length,1);
 assert.ok(calls.every(x=>x.url.startsWith(DEV_URL+'/')));
});
test('bridge approves only authenticated encrypted exact revision, no dispatch RPC',async()=>{
 const c=businessConfig(env),row={comment_ref:'a'.repeat(64),revision:'b'.repeat(64),status:'proposed'};
 row.decision_box=crypto.seal(c,'commercial-review',[row.comment_ref,row.revision],{public_proposal:'Synthetic price'});
 const ops=[];const fetchImpl=async(url,options)=>{
  let data;
  if(url.endsWith('/user'))data={id:actor.id};else if(url.includes('/profiles?'))data=[actor];
  else if(url.endsWith('/comment_bridge_request_v1'))data=true;
  else{assert.ok(url.endsWith('/comment_review_v1'));const p=JSON.parse(options.body);ops.push(p.p_op);
   if(p.p_op==='list')data=[row];else{assert.equal(p.p_op,'approve');assert.equal(crypto.open(c,'commercial-approval',[row.comment_ref,row.revision,actor.id],p.p_data.approval_box).text,'Synthetic approval');data={status:'approved_not_sent'};}
  }return{ok:true,json:async()=>data};
 };
 const res={setHeader(){},status(n){this.code=n;return this;},json(x){this.body=x;return this;}};
 await createBridgeReceiver({env,fetchImpl})(post({op:'approve',comment:row.comment_ref,revision:row.revision,text:'Synthetic approval'}),res);
 assert.equal(res.code,200);assert.equal(res.body.sender,false);assert.deepEqual(ops,['list','approve']);
});
test('inactive, unauthorized and mismatched profiles deny before journal',async()=>{
 for(const profile of [{...actor,active:false},{...actor,role_id:'asesor'},{...actor,id:'different'}]){const {res,calls}=await run({profile});assert.equal(res.code,403);assert.equal(calls.length,2);}
});
test('invalid signature performs zero upstream calls; sender ON blocks journal',async()=>{
 const bad=req();bad.headers['x-review-signature']='0'.repeat(86);const a=await run({request:bad});assert.equal(a.calls.length,0);
 const b=await run({environment:{...env,INSTAGRAM_BUSINESS_MANUAL_SEND_ENABLED:'true'}});assert.equal(b.res.code,503);assert.equal(b.calls.length,2);
});
test('exact encrypted review projects; binding tamper denied without leaking ciphertext',async()=>{
 const c=businessConfig(env),row={comment_ref:'1'.repeat(64),revision:'2'.repeat(64),status:'escalated',destination:'ventas',opportunity:true};
 row.decision_box=crypto.seal(c,'commercial-review',[row.comment_ref,row.revision],{platform:'instagram',reason:'synthetic',comment_ref:row.comment_ref});
 const a=await run({rows:[row]});assert.equal(a.res.code,200);assert.equal(a.res.body.rows[0].reason,'synthetic');assert.equal(JSON.stringify(a.res.body).includes(row.decision_box.data),false);
 const b=await run({rows:[{...row,revision:'3'.repeat(64)}]});assert.equal(b.res.code,503);assert.deepEqual(b.res.body.diagnostic,{stage:'projection',code:'bridge_read_denied'});
});
test('proxy pins destination, rejects redirects/errors and never retries',async()=>{
 let calls=0;const fetchImpl=async(url,opts)=>{calls++;assert.equal(opts.redirect,'error');throw Error('private error');};
 await assert.rejects(readThroughBridge(env,auth,fetchImpl,'synthetic-oidc'));assert.equal(calls,1);
 for(const url of ['http://localhost'+BRIDGE_PATH,'https://evil.test'+BRIDGE_PATH,env.COMMENT_REVIEW_BRIDGE_URL+'?x=1'])await assert.rejects(readThroughBridge({...env,COMMENT_REVIEW_BRIDGE_URL:url},auth,fetchImpl));assert.equal(calls,1);
});
test('populated evaluation reuses encrypted capture and escalates missing evidence; never sends',async()=>{
 const c=businessConfig(env),r={comment_ref:'1'.repeat(64),media_ref:'2'.repeat(64),event_ref:'3'.repeat(64),occurred_at:new Date(Date.now()-1000).toISOString()};
 const binding=[r.comment_ref,r.media_ref,r.event_ref,r.occurred_at];
 r.content_box=crypto.seal(c,'comment-content',binding,{text:'precio',username:'synthetic'});
 r.native_box=crypto.seal(c,'comment-native',binding,{comment_id:'123',media_id:'456'});
 const writes=[];const db={rpc:async(name,args)=>{if(name==='ig_business_comments_v1')return{data:[r]};assert.equal(name,'ig_business_token_v1');assert.equal(args.p_op,'load');return{data:null};}};
 const result=await evaluateInstagram({db,c,actor,store:async(op,data)=>{writes.push({op,data});return{};},fetchImpl:async()=>{throw Error('network forbidden');}});
 assert.equal(result.processed,1);assert.deepEqual(writes.map(x=>x.op),['capture','evaluate']);
 assert.equal(writes[1].data.status,'escalated');assert.equal(result.sender,false);
 const decision=crypto.open(c,'commercial-review',[r.comment_ref,writes[1].data.revision],writes[1].data.decision_box);
 assert.equal(decision.public_proposal,null);assert.equal(decision.publish_allowed,false);
});
