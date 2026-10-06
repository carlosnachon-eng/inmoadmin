import test from 'node:test';
import assert from 'node:assert/strict';
import { withCommercialExecution,recoverCommercialExecutionOne } from '../lib/social/commercialExecution.js';
import { memoryDb,importWithStubs,response } from './helpers/socialFixtures.mjs';
import { processOneSalesAutoOutbound } from '../lib/agentsV2/salesAutoOutbound.js';

const env={SOCIAL_ROUTING_V1_ENABLED:'true'};
test('missing claim proof fails closed without entering processor or legacy',async()=>{
  for(const result of [{error:{}},{data:null},{data:{}}])await assert.rejects(
    withCommercialExecution({rpc:async()=>result},'SALES','i',env,()=>assert.fail()),/claim_unverified/);
});
test('journal denial cannot be converted to legacy claim',async()=>{
  for(const state of ['not_claimed','disabled','paused','review_required']){
    const db={rpc:async()=>({data:{managed:true,authorized:false,state}})};
    assert.equal((await withCommercialExecution(db,'SALES','i',env,()=>assert.fail())).status,state);
  }
});
test('unknown checkpoint outcome halts before model, regardless of error recovery reply',async()=>{
  const seen=[];
  const db={rpc:async(name,a)=>{
    if(name==='claim_respond_execution_v1')return{data:{managed:true,authorized:true,token:'t',inbound:{id:'i'}}};
    seen.push(a.p_action);return{error:{code:'08006'}};
  }};
  await assert.rejects(withCommercialExecution(db,'SALES','i',env,async e=>{await e.step('model');assert.fail('must not generate');}),/requires_review/);
  assert.deepEqual(seen,['model','error']);
});
test('confirmed failed model uses only hashed session evidence and halts the attempt',async()=>{
  let evidence;
  const db={rpc:async(name,a)=>name==='claim_respond_execution_v1'?{data:{managed:true,authorized:true,token:'t'}}:
    (evidence=a,{data:{allowed:false,state:'retryable'}})};
  const result=await withCommercialExecution(db,'OWNER','i',env,async e=>{await e.modelResult({status:'failed',id:'synthetic-session-private'});assert.fail();});
  assert.equal(result.status,'retryable');assert.equal(evidence.p_action,'model_failed');assert.match(evidence.p_session_ref,/^[a-f0-9]{64}$/);
});
test('Social OFF cannot even select execution recovery candidates',async()=>{
  assert.equal((await recoverCommercialExecutionOne({rpc:()=>assert.fail()},{env:{}})).status,'disabled');
});
test('hosted certification stale-clock runs cannot be sent by the existing background sender',async()=>{
  const db=memoryDb({sales_agent_v2_shadow_runs:[{id:'synthetic-run',status:'idle',completed_at:new Date(Date.now()-7*86400000).toISOString(),
    sales_agent_v2_inbound_messages:{id:'synthetic-inbound',respond_contact_id:'synthetic-dev-only',channel_id:'497382'}}]});
  const result=await processOneSalesAutoOutbound(db,{env:{SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED:'true',VERCEL_ENV:'production',
    SUPABASE_ENVIRONMENT:'production',RESPOND_IO_TOKEN:'synthetic-never-used'}});
  assert.equal(result.status,'idle');assert.ok(db.operations.every(o=>o.op==='select'));
});
test('review remains admin-only, read-only, with no payload/token/session leakage',async()=>{
  const mod=await importWithStubs(new URL('../pages/api/operaciones/social-routing.js',import.meta.url),{
    '@supabase/supabase-js':{createClient:()=>assert.fail()},
    '../../../lib/ejecutivo/workCenter.js':{respondInboxLink:id=>'https://app.respond.io/space/fixture/inbox/'+id},
  });
  const db=memoryDb({respond_commercial_executions:[{event_id:'synthetic-e',lane:'SALES',state:'review_required',phase:'model',attempts:2,
    reason:'attempts_exhausted',respond_contact_id:'999170',token:'private-token',audit:[{secret:'private-audit'}]}]});
  const handler=mod.createSocialRoutingReviewHandler({authorize:async()=>({active:true,role_id:'admin'}),createAdmin:()=>db,env});
  const res=response();await handler({method:'GET',headers:{},query:{}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.executionReviews[0].reason,'attempts_exhausted');
  assert.doesNotMatch(JSON.stringify(res.body),/private-token|private-audit|synthetic-e/);
  assert.ok(db.operations.every(o=>o.op==='select'));
  const denied=mod.createSocialRoutingReviewHandler({authorize:async()=>({active:true,role_id:'gerente'}),createAdmin:()=>assert.fail()});
  const no=response();await denied({method:'GET',headers:{}},no);assert.equal(no.statusCode,403);
});
