import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createControlledOutboundOperator} from '../lib/messaging/metaAdminCapture/controlledOutboundOperator.js';

const input='7525387c-093a-4c41-aa68-9f27151a9182';
const env={META_ADMIN_OUTBOUND_OPERATOR_SECRET:'synthetic-operator-secret-not-real-0000',META_ADMIN_CONTROLLED_OUTBOUND_ENABLED:'true',
  META_ADMIN_CONTROLLED_OUTBOUND_INPUT_ID:input,META_ADMIN_OUTBOUND_ACCESS_TOKEN:'synthetic-token',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',
  NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',OPENAI_ADMIN_AGENT_MODEL:'gpt-6-luna',META_ADMIN_CAPTURE_ENCRYPTION_KEY:'a'.repeat(64),META_ADMIN_CAPTURE_HMAC_KEY:'b'.repeat(64)};
const journal={status:'accepted',send_calls:1,sent:false,delivered:false,read:false,failed:false,contradictory:false};
async function invoke({environment={},request={},row=null,throwRun=false,throwRead=false}={}){
  let calls=0,stores=0,reads=0,current=row;
  const handler=createControlledOutboundOperator({env:{...env,...environment},makeStore(){stores++;return {contextDb:{},async status(){reads++;if(throwRead)throw Error('PRIVATE');return current;}};},
    async run(args){calls++;assert.equal(args.inputId,input);if(throwRun)throw Error('PRIVATE');current={...journal,phone:'PRIVATE',payload:'PRIVATE',token:'PRIVATE'};return {payload:'PRIVATE'};}});
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:'POST',headers:{authorization:`Bearer ${env.META_ADMIN_OUTBOUND_OPERATOR_SECRET}`},body:{},query:{},...request},res);
  assert.ok(!JSON.stringify(res).includes('PRIVATE'));
  return {res,calls,stores,reads};
}
for(const [name,options,code] of [
  ['GET',{request:{method:'GET'}},405],['no auth',{request:{headers:{}}},401],['bad auth',{request:{headers:{authorization:'Bearer wrong'}}},401],
  ['missing secret',{environment:{META_ADMIN_OUTBOUND_OPERATOR_SECRET:''}},401],['wrong input',{request:{body:{input_id:'other'}}},403],
  ['even authorized body input rejected',{request:{body:{input_id:input}}},403],
  ['missing env input',{environment:{META_ADMIN_CONTROLLED_OUTBOUND_INPUT_ID:''}},403],
  ['extra recipient',{request:{body:{input_id:input,to:'forbidden'}}},403],['query',{request:{query:{input_id:input}}},403],
  ['OFF',{environment:{META_ADMIN_CONTROLLED_OUTBOUND_ENABLED:'false'}},409],['missing token',{environment:{META_ADMIN_OUTBOUND_ACCESS_TOKEN:''}},503],
  ['wrong model',{environment:{OPENAI_ADMIN_AGENT_MODEL:'claude'}},503],['bad encryption key',{environment:{META_ADMIN_CAPTURE_ENCRYPTION_KEY:'bad'}},503]
])test(`operator: ${name} fails closed before store`,async()=>{const r=await invoke(options);assert.equal(r.res.code,code);assert.equal(r.calls,0);assert.equal(r.stores,0);});
test('operator: one call, journal status only',async()=>{const r=await invoke();assert.equal(r.calls,1);assert.equal(r.reads,2);assert.deepEqual(r.res.body,{status:'accepted'});});
for(const status of ['reserved','dispatch_started','accepted','failed','uncertain','review_required'])test(`operator: prior ${status} never reruns`,async()=>{
  const r=await invoke({row:{...journal,status}});assert.equal(r.calls,0);assert.equal(r.res.body.status,['reserved','dispatch_started'].includes(status)?'already_consumed':status);
});
test('operator: runner throws, no retry',async()=>{const r=await invoke({throwRun:true});assert.equal(r.calls,1);assert.deepEqual(r.res.body,{status:'uncertain'});});
test('operator: read fails, no execution',async()=>{const r=await invoke({throwRead:true});assert.equal(r.calls,0);assert.deepEqual(r.res.body,{status:'uncertain'});});
test('operator: malformed existing journal fails closed',async()=>{const r=await invoke({row:{status:'PRIVATE'}});assert.equal(r.calls,0);assert.equal(r.res.code,503);});
