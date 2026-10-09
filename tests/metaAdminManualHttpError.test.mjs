import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeManualMetaHttpError} from '../lib/messaging/metaAdminInbox/metaHttpError.js';
import {sendMetaTextOnce} from '../lib/messaging/metaAdminCapture/metaTextTransport.js';
import {createManualStore} from '../lib/messaging/metaAdminInbox/manual.js';
const error={error:{code:200,error_subcode:33,type:'OAuthException',message:'(#200) Permissions error',error_data:{details:'Application does not have permission for this action'},fbtrace_id:'not-persisted'}};
test('retains structured error with recognized diagnostic prose only',()=>{
 assert.deepEqual(sanitizeManualMetaHttpError(403,error),{http_status:403,code:200,subcode:33,type:'OAuthException',message:'(#200) Permissions error',details:'Application does not have permission for this action'});
});
test('request echoes, arbitrary PII and secrets never survive in fields or extra keys',()=>{
 for(const message of ['Token SECRET','Persona: Nombre Apellido','https://host.test/?access_token=SECRET','recipient 5212221234567','mail@example.test',JSON.stringify({headers:{Authorization:'Bearer SECRET'},payload:{to:'5212221234567'}})]) {
  const out=sanitizeManualMetaHttpError(403,{error:{...error.error,message,error_data:{details:message},type:message,recipient:message}},['SECRET']);
  assert.ok(!JSON.stringify(out).includes(message));assert.equal(out.type,null);
 }
});
test('even allowlisted prose is removed if it echoes a known request value',()=>{
 assert.equal(sanitizeManualMetaHttpError(403,error,['Permissions error']).message,'[REDACTED]');
});
test('absent/malformed structured fields stay null, never copied as raw objects',()=>{
 assert.deepEqual(sanitizeManualMetaHttpError(502,{error:{code:'200',error_subcode:{token:'x'},message:{secret:'x'}}}),{http_status:502,code:null,subcode:null,type:null,message:null,details:null});
});
const args={phoneNumberId:'synthetic',to:'synthetic',text:'synthetic',accessToken:'synthetic'};
test('manual HTTP403 is one attempt and carries sanitized metadata',async()=>{
 let n=0;const r=await sendMetaTextOnce({...args,httpErrorProjection:sanitizeManualMetaHttpError,fetchImpl:async()=>{n++;return {ok:false,status:403,json:async()=>error};}});
 assert.equal(n,1);assert.equal(r.status,'failed');assert.equal(r.http_error.code,200);assert.equal(r.wamid,null);
});
test('automatic transport contract remains unchanged without manual projection',async()=>{
 const r=await sendMetaTextOnce({...args,fetchImpl:async()=>({ok:false,status:403,json:async()=>error})});
 assert.deepEqual(r,{status:'failed',wamid:null});
});
test('non-JSON HTTP failure retains status without body and stays uncertain',async()=>{
 const r=await sendMetaTextOnce({...args,httpErrorProjection:sanitizeManualMetaHttpError,fetchImpl:async()=>({ok:false,status:502,json:async()=>{throw Error('raw secret');}})});
 assert.equal(r.status,'uncertain');assert.equal(r.http_error.http_status,502);assert.equal(r.http_error.message,null);
});
test('network failure has no invented HTTP status or raw exception',async()=>{
 const r=await sendMetaTextOnce({...args,httpErrorProjection:sanitizeManualMetaHttpError,fetchImpl:async()=>{throw Error('secret');}});
 assert.deepEqual(r,{status:'uncertain',wamid:null});
});
test('accepted keeps existing wamid contract; no error metadata',async()=>{
 const r=await sendMetaTextOnce({...args,httpErrorProjection:sanitizeManualMetaHttpError,fetchImpl:async()=>({ok:true,json:async()=>({messages:[{id:'wamid.synthetic'}]})})});
 assert.deepEqual(r,{status:'accepted',wamid:'wamid.synthetic'});
});
test('manual store persists error atomically via restricted finish RPC, success stays v1',async()=>{
 const calls=[];const store=createManualStore({rpc:async(name,args)=>{calls.push({name,args});return {data:true};}});
 const a={actionId:'fixture',token:'claim'},http_error=sanitizeManualMetaHttpError(403,error);
 await store.finish(a,{status:'failed',wamid:null,http_error});
 assert.equal(calls[0].name,'meta_admin_manual_finish_http_error_v1');assert.deepEqual(calls[0].args.p_http_error,http_error);
 await store.finish(a,{status:'accepted',wamid:'wamid.synthetic'});assert.equal(calls[1].name,'meta_admin_manual_finish_v1');
});
