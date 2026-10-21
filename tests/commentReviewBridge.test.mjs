import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {bridgeHeaders,verifyBridge,readThroughBridge,BRIDGE_PATH,BRIDGE_BRANCH,DEV_URL} from '../lib/messaging/commentAgent/bridge.js';
import {createBridgeReceiver} from '../lib/messaging/commentAgent/bridgeReceiver.js';
import * as crypto from '../lib/messaging/instagram/business/crypto.js';
import {businessConfig} from '../lib/messaging/instagram/business/config.js';
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
 const {res,calls}=await run();assert.equal(res.code,200);assert.equal(res.body.read_only,true);assert.equal(res.body.sender,false);assert.equal(calls.length,3);
 assert.ok(calls.every(x=>x.url.startsWith(DEV_URL+'/')));assert.equal(JSON.parse(calls[2].options.body).p_op,'list');
 assert.equal(calls[0].options.headers.Authorization,auth);assert.equal(calls[1].options.headers.Authorization,auth);
 assert.equal(JSON.stringify(res.body).includes('synthetic-service'),false);
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
