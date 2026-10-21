import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {syntheticQa,QA_CONNECTION} from '../tools/comment-review-bridge/syntheticQa.js';
import {bridgeHeaders,BRIDGE_PATH,BRIDGE_BRANCH,DEV_URL} from '../lib/messaging/commentAgent/bridge.js';
test('isolated Preview fixture preserves authentication and only forwards review journal calls',async()=>{
 const keys=generateKeyPairSync('ed25519'),actor=randomUUID(),calls=[],reviews=[];
 let clock=Date.now(),role='admin';
 const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:BRIDGE_BRANCH,NEXT_PUBLIC_SUPABASE_URL:DEV_URL,SUPABASE_SERVICE_ROLE_KEY:'test-service',
  COMMENT_REVIEW_BRIDGE_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}),COMMENT_REVIEW_BRIDGE_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'pem'})};
 const fetchImpl=async(raw,options)=>{
  const u=new URL(raw);assert.equal(u.origin,DEV_URL);calls.push(u.pathname);
  let data;
  if(u.pathname==='/auth/v1/user')data={id:actor};
  else if(u.pathname==='/rest/v1/profiles')data=[{id:actor,active:true,role_id:role}];
  else{
   const p=JSON.parse(options.body);assert.equal(p.p_connection,QA_CONNECTION);
   if(u.pathname.endsWith('comment_bridge_request_v1'))data=true;
   else {assert.ok(u.pathname.endsWith('comment_review_v1'));assert.ok(['capture','evaluate','list','approve'].includes(p.p_op));
    if(p.p_op==='evaluate'){reviews.push({...p.p_data});data={status:'recorded'};}
    if(p.p_op==='list')data=reviews;
    if(p.p_op==='approve'){Object.assign(reviews[0],{...p.p_data,status:'approved',approved_by:actor});data={status:'approved_not_sent'};}
    if(p.p_op==='capture')data={inserted:1};
   }
  }
  return {ok:true,json:async()=>data};
 };
 const handler=syntheticQa({env,fetchImpl,expiresAt:clock+600000,now:()=>clock});
 const req=body=>{const raw=body?JSON.stringify(body):'',method=body?'POST':'GET';return new Request('https://example.test'+BRIDGE_PATH,{method,headers:{...bridgeHeaders(env,'Bearer test.user',Date.now(),method,raw,body?randomUUID():''),...(body?{'content-type':'application/json'}:{})},...(body?{body:raw}:{})});};
 assert.equal((await (await handler(req({op:'evaluate'}))).json()).processed,1);
 assert.equal(reviews[0].status,'proposed');
 const listed=await (await handler(req())).json();
 const body={op:'approve',comment:listed.rows[0].comment_ref,revision:listed.rows[0].revision,text:'QA sintética: aprobado sin publicación.'};
 assert.equal((await (await handler(req(body))).json()).status,'approved_not_sent');
 assert.equal((await (await handler(req())).json()).rows[0].approved_text,body.text);
 assert.ok(!calls.some(x=>/token|comments_v1|propiedades/.test(x)));
 role='asesor';assert.equal((await handler(req())).status,403);
 const before=calls.length;clock+=600001;assert.equal((await handler(req())).status,410);assert.equal(calls.length,before);
 assert.throws(()=>syntheticQa({env:{...env,VERCEL_ENV:'production'},expiresAt:clock+1000}),/qa_environment/);
 assert.throws(()=>syntheticQa({env:{...env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co'},expiresAt:clock+1000}),/qa_environment/);
});
