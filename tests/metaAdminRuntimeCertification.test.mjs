import test from 'node:test';
import assert from 'node:assert/strict';
import {certifyMetaRuntime,createRuntimeCertificationHandler,CERTIFICATION_EXPIRES} from '../lib/messaging/metaAdminCapture/runtimeCertification.js';
const secret='NEVER_OUTPUT_TOKEN',env={META_ADMIN_OUTBOUND_ACCESS_TOKEN:secret,
  META_ADMIN_CONNECTION_CERTIFICATION_ENABLED:'true',META_ADMIN_MANUAL_REPLY_ENABLED:'true',
  VERCEL_ENV:'production',META_ADMIN_WABA_ID:'1297760461811288',META_ADMIN_PHONE_NUMBER_ID:'1198305790026665'};
const bodies=[{data:{is_valid:true,app_id:'1728488815945294',user_id:'61595438812168',
  scopes:['whatsapp_business_management','whatsapp_business_messaging'],expires_at:0}},
  {id:'61595438812168'},{id:'1297760461811288'},{data:[{id:'1198305790026665'}]},
  {id:'1198305790026665'},{data:[{whatsapp_business_api_data:{id:'1728488815945294'}}]},
  {status:'DISCONNECTED',platform_type:'CLOUD_API',code_verification_status:'VERIFIED'},
  {health_status:{can_send_message:'BLOCKED',entities:[{errors:[{code:141011,message:secret}]}]}},
  {is_on_biz_app:true},{data:[{permission:'whatsapp_business_messaging',status:'granted'}]}];
const mocked=async(url,o)=>{
  assert.equal(url,'https://graph.facebook.com/v26.0/');assert.ok(!url.includes(secret));
  assert.equal(o.redirect,'error');const batch=JSON.parse(new URLSearchParams(o.body).get('batch'));
  assert.equal(batch.length,10);assert.ok(batch.every(x=>x.method==='GET'&&!/\/messages|\/register|\/deregister/.test(x.relative_url)));
  return {ok:true,json:async()=>bodies.map(body=>({code:200,body:JSON.stringify({...body,token:secret})}))};
};
test('in-runtime token certification uses reads only, exposes effective gate and expected identity without secret',async()=>{
  const out=await certifyMetaRuntime({env,fetchImpl:mocked});
  assert.equal(out.token.valid,true);assert.equal(out.token.expected_system_user_matches,true);
  assert.equal(out.subscription.expected_app_present,true);assert.equal(out.number.status,'DISCONNECTED');
  assert.equal(out.runtime.manual_reply_gate,true);assert.equal(out.eligibility,'not_confirmed');assert.equal(out.send_calls,0);
  assert.ok(!JSON.stringify(out).includes(secret));
});
test('permission errors and unknown account state remain unknown; no retry',async()=>{
  let calls=0;const out=await certifyMetaRuntime({env,fetchImpl:async()=>{calls++;
    return {ok:true,json:async()=>bodies.map(()=>({code:403,body:JSON.stringify({error:{code:10,message:secret}})}))};}});
  assert.equal(calls,1);assert.equal(out.token.valid,null);assert.equal(out.membership,null);
  assert.equal(out.subscription.expected_app_present,null);assert.ok(!JSON.stringify(out).includes(secret));
});
test('pagination does not claim a complete subscription or membership',async()=>{
  const copy=structuredClone(bodies);copy[3].paging={next:'https://invalid/'+secret};copy[5].paging={next:'https://invalid/'+secret};
  const out=await certifyMetaRuntime({env,fetchImpl:async()=>({ok:true,json:async()=>copy.map(body=>({code:200,body:JSON.stringify(body)}))})});
  assert.equal(out.membership,null);assert.equal(out.subscription.expected_app_present,null);
  assert.equal(out.subscription.complete,false);assert.ok(!JSON.stringify(out).includes(secret));
});
test('unknown/other actor and credential absence never invent a valid token',async()=>{
  const copy=structuredClone(bodies);copy[0].data.user_id='99999999999';
  const out=await certifyMetaRuntime({env,fetchImpl:async()=>({ok:true,json:async()=>copy.map(body=>({code:200,body:JSON.stringify(body)}))})});
  assert.equal(out.token.expected_system_user_matches,false);assert.equal(out.token.identity_conflict,true);
  const missing=await certifyMetaRuntime({env:{},fetchImpl:()=>assert.fail('network')});assert.equal(missing.status,'credential_unavailable');
});
const res=()=>({setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
test('authorized runtime endpoint returns only sanitized reads',async()=>{
 const r=res();await createRuntimeCertificationHandler({env,authorize:async()=>({active:true,role_id:'admin'}),
   now:()=>CERTIFICATION_EXPIRES-1,fetchImpl:mocked})({method:'GET',headers:{host:'app.emporioinmobiliario.com.mx'}},r);
 assert.equal(r.code,200);assert.equal(r.body.runtime.manual_reply_gate,true);
 assert.ok(!JSON.stringify(r.body).includes(secret));
});
for(const [name,cfg,actor,req,now,code] of [
  ['off',{},null,{method:'GET'},0,404],['expired',env,null,{method:'GET'},CERTIFICATION_EXPIRES,410],
  ['staff',env,{active:true,role_id:'staff'},{method:'GET'},0,403],
  ['no session',env,null,{method:'GET'},0,403],
  ['post',env,null,{method:'POST'},0,405],['arbitrary scope',env,null,{method:'GET',query:{waba:'other'}},0,405]])
test('runtime endpoint blocks '+name+' without using token',async()=>{
  const r=res();await createRuntimeCertificationHandler({env:cfg,authorize:async()=>actor,now:()=>now,
    fetchImpl:()=>assert.fail('network')})({...req,headers:{host:'app.emporioinmobiliario.com.mx'}},r);assert.equal(r.code,code);
});
test('immutable production deployment host cannot execute certification',async()=>{
 const r=res();await createRuntimeCertificationHandler({env,authorize:()=>assert.fail('auth'),now:()=>0,
   fetchImpl:()=>assert.fail('network')})({method:'GET',headers:{host:'temporary.vercel.app'}},r);
 assert.equal(r.code,404);
});
