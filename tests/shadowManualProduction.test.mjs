import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {productionMemory,productionEnv} from './helpers/manualProductionFixture.mjs';
import {manualDecision,syntheticResponse} from './helpers/manualTurnFixture.mjs';
import {authorizeManualProductionTurn as authorize,executeManualProductionTurn as execute,readManualProductionTurn as read,closeManualProductionTurn as close,readManualProductionForMessage} from '../lib/shadow/ai/manualTurnProduction.js';
import {MANUAL_PROD_GATE,MANUAL_PROD_MODE,manualProductionSameOrigin} from '../lib/shadow/ai/manualTurnProductionPolicy.js';
import {assertManualTurnProduction,MANUAL_TURN_OFF_GATES,withManualProductionContext,reserveManualTurnTransmission} from '../lib/shadow/ai/manualTurnContext.js';
import {createManualTurnHandler} from '../lib/shadow/ai/manualTurnApi.js';
import {inspectExplicitRetry} from '../lib/shadow/ai/explicitRetry.js';
import {buildReducedAnthropicDecisionSchema} from '../lib/shadow/ai/reducedOutputSchema.js';
const options={env:productionEnv,fetchImpl:async()=>syntheticResponse()};
const prepare=async f=>authorize(f.db,f.messageRef,f.actor,productionEnv);
const off={...productionEnv,[MANUAL_PROD_GATE]:'false'};
const headers={host:'app.emporioinmobiliario.com.mx',origin:'https://app.emporioinmobiliario.com.mx','x-forwarded-proto':'https'};
test('production full path closes, persists safe message provenance and reads OFF',async()=>{
  const f=productionMemory({text:'Hay una fuga.'}),a=await prepare(f);let n=0;
  const r=await execute(f.db,a.authorizationRef,f.actor,{...options,fetchImpl:async(_url,init)=>{
    n++;assert.equal(f.db.tables.shadow_manual_prod_turn_control[0].reserved_transmissions,n);
    const body=JSON.parse(init.body);assert.deepEqual(body.output_config.format.schema,buildReducedAnthropicDecisionSchema());
    assert.doesNotMatch(init.body,/123456|synthetic-only|manual-turn-captured/);return syntheticResponse();}});
  assert.equal(r.certified,true);assert.equal(r.status,'completed');assert.ok(r.closed_at);assert.ok(n>=1&&n<=2);
  assert.equal(r.conversation_action.message_safe,true);assert.equal(r.conversation_action.message_safe_provenance,'semantic_conversation_guard_v1');
  assert.equal(r.runtime.sha,productionEnv.VERCEL_GIT_COMMIT_SHA);assert.equal(r.outbound_authorized,false);
  const refreshed=await read(f.db,a.authorizationRef,f.actor,off);assert.equal(refreshed.certified,true);assert.equal(refreshed.capabilities.execute,false);
  assert.equal(refreshed.gates_effective[MANUAL_PROD_GATE],false);assert.equal(refreshed.gates_at_authorization[MANUAL_PROD_GATE],true);
  assert.equal(f.db.tables.shadow_ai_runs.length,1);assert.equal(r.reserved_transmissions,n);
  assert.ok(f.db.writes.every(w=>['shadow_ai_runs','shadow_ai_decisions','shadow_conversation_actions'].includes(w.table)));
  assert.ok(!JSON.stringify(r).includes(f.messageId));assert.ok(!JSON.stringify(r).includes('123456'));
});
test('production two real transport paths, issued contact alias, zero identity writes',async()=>{
  const f=productionMemory(),a=await prepare(f);let n=0;
  const r=await execute(f.db,a.authorizationRef,f.actor,{...options,fetchImpl:async(_u,init)=>{
    const context=JSON.parse(JSON.parse(init.body).messages[0].content),d=structuredClone(manualDecision);
    if(++n===1)d.proposedToolCalls=[{tool:'resolve_contact_identity',arguments:[{key:'respondContactId',value:context.metadata.respondContactId}],reason:'Consultar identidad'}];
    return syntheticResponse(d);}});
  assert.equal(n,2);assert.equal(r.reserved_transmissions,2);assert.equal(r.certified,true);
  assert.ok(r.telemetry.tools.some(t=>t.name==='resolve_contact_identity'&&t.ok));assert.equal(f.db.writes.filter(w=>w.table==='respond_identity_audit').length,0);
  for(const x of r.telemetry.rounds){assert.equal(x.receipt.final_payload_verified,true);assert.equal(x.receipt.serialized_body_verified,true);assert.equal(x.receipt.provider_invoked,true);}
});
test('close while OFF is irreversible and stops unused authorization',async()=>{
  const f=productionMemory(),a=await prepare(f);const r=await close(f.db,a.authorizationRef,f.actor,off);
  assert.equal(r.status,'closed');const date=r.closed_at;assert.equal((await close(f.db,a.authorizationRef,f.actor,off)).closed_at,date);
  await assert.rejects(()=>execute(f.db,a.authorizationRef,f.actor,options),/manual_prod_closed/);
  assert.equal(f.db.tables.shadow_ai_runs.length,0);await assert.rejects(()=>prepare(f),/not_renewable/);
});
test('closing between rounds prevents second transmission, tools/3B continuation',async()=>{
  const f=productionMemory(),a=await prepare(f);let n=0;
  const r=await execute(f.db,a.authorizationRef,f.actor,{...options,fetchImpl:async()=>{n++;await close(f.db,a.authorizationRef,f.actor,off);return syntheticResponse();}});
  assert.equal(n,1);assert.equal(r.status,'error');assert.equal(r.certified,false);assert.equal(r.telemetry.failure.error_code,'manual_prod_closed');assert.equal(r.conversation_action_persisted,false);
});
test('capability has at most two reservations, cannot survive callback',async()=>{
  let saved,n=0;await withManualProductionContext(productionEnv,async()=>{n++;},async c=>{saved=c;
    await reserveManualTurnTransmission(c);await reserveManualTurnTransmission(c);
    await assert.rejects(()=>reserveManualTurnTransmission(c),/transmission_limit/);});
  assert.equal(n,2);await assert.rejects(()=>reserveManualTurnTransmission(saved),/context_required/);
});
test('uncertain reservation: no provider call and no retry',async()=>{
  const f=productionMemory(),a=await prepare(f),base=f.db.rpc;let n=0;
  f.db.rpc=async(name,p)=>name==='reserve_manual_shadow_prod_round'?{error:{message:'transport disconnected'}}:base(name,p);
  const r=await execute(f.db,a.authorizationRef,f.actor,{...options,fetchImpl:async()=>{n++;return syntheticResponse();}});
  assert.equal(n,0);assert.equal(r.status,'error');assert.ok(r.closed_at);assert.equal(r.telemetry.rounds[0].receipt.provider_invoked,false);
  assert.equal(r.telemetry.rounds[0].receipt.serialized_body_verified,true);assert.equal(r.certified,false);
});
test('timeout conserves receipt, unknown usage, single consumed run and closed window',async()=>{
  const f=productionMemory(),a=await prepare(f);let n=0;
  const r=await execute(f.db,a.authorizationRef,f.actor,{env:{...productionEnv,SHADOW_AI_ANTHROPIC_ATTEMPT_TIMEOUT_MS:'5'},fetchImpl:async(_u,{signal})=>{
    n++;return new Promise((_ok,reject)=>signal.addEventListener('abort',()=>reject(Error('synthetic timeout')),{once:true}));}});
  assert.equal(r.status,'timeout');assert.equal(n,1);assert.equal(r.certified,false);assert.ok(r.closed_at);
  const receipt=r.telemetry.rounds[0];assert.equal(receipt.receipt.provider_invoked,true);assert.equal(receipt.input_tokens,null);assert.equal(receipt.model,null);
  const duplicate=await execute(f.db,a.authorizationRef,f.actor,options);assert.equal(duplicate.duplicate,true);assert.equal(f.db.tables.shadow_ai_runs.length,1);
});
test('3B failure preserves partial 3A as un-certified, closed, not retried',async()=>{
  const f=productionMemory(),a=await prepare(f),r=await execute(f.db,a.authorizationRef,f.actor,{...options,persistManualAction:async()=>{throw Error('synthetic');}});
  assert.equal(r.status,'error');assert.equal(r.certified,false);assert.equal(r.decision_persisted,true);assert.equal(r.conversation_action_persisted,false);assert.ok(r.closed_at);
});
test('no_message is persisted as silence, message_safe unknown rather than invented true',async()=>{
  const f=productionMemory({text:'Gracias.'}),a=await prepare(f),r=await execute(f.db,a.authorizationRef,f.actor,{...options,fetchImpl:async()=>syntheticResponse({...manualDecision,intent:'no_determinado',conversationalResponseParts:{acknowledgement:'Gracias.',verifiedFactReferences:[],clarificationQuestion:null,escalationMessage:null}})});
  assert.equal(r.certified,true);assert.equal(r.conversation_action.conversation_action,'no_message');assert.equal(r.conversation_action.message_safe,null);
});
for(const gate of MANUAL_TURN_OFF_GATES)test(`production requires literal OFF: ${gate}`,()=>{
  for(const value of ['true',undefined,'FALSE'])assert.throws(()=>assertManualTurnProduction({...productionEnv,[gate]:value}));
});
for(const patch of [{VERCEL_ENV:'preview'},{VERCEL_ENV:undefined},{SUPABASE_ENVIRONMENT:'dev'},{NEXT_PUBLIC_SUPABASE_URL:'https://hjfwjnejbcpmknvfpdcq.supabase.co'},{SHADOW_MANUAL_TURN_DEV_ENABLED:'true'},{VERCEL_GIT_COMMIT_SHA:''},{VERCEL_DEPLOYMENT_ID:''},{SHADOW_AI_OUTPUT_MODE:'text_json_local'},{[MANUAL_PROD_GATE]:'false'}])test(`prod pin ${JSON.stringify(patch)}`,()=>assert.throws(()=>assertManualTurnProduction({...productionEnv,...patch})));
for(const patch of [{origin:'http://app.emporioinmobiliario.com.mx'},{host:'localhost:3000'},{origin:'https://evil.example'},{'x-forwarded-host':'evil.example'},{'x-forwarded-proto':'http'}])test(`same origin refuses ${JSON.stringify(patch)}`,()=>assert.equal(manualProductionSameOrigin({method:'POST',headers:{...headers,...patch}}),false));
test('API read and close OFF; non-admin/origin reject; body cannot inject runtime or provider',async()=>{
  const f=productionMemory(),a=await prepare(f);
  const call=async(env,actor,req)=>{const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.value=v;}};
    await createManualTurnHandler({authorize:async()=>actor,createAdmin:()=>f.db,env})(req,res);return res;};
  const get={method:'GET',headers,query:{mode:'manual_turn',authorizationRef:a.authorizationRef}};
  assert.equal((await call(off,f.actor,get)).code,200);
  assert.equal((await call(off,{...f.actor,role_id:'asesor'},get)).code,403);
  assert.equal((await call(off,{...f.actor,active:false},get)).code,403);
  assert.equal((await call(off,f.actor,{...get,headers:{...headers,origin:'https://evil.example'}})).code,403);
  assert.equal((await call(off,f.actor,{method:'POST',headers,body:{mode:'manual_turn',action:'execute',authorizationRef:a.authorizationRef}})).code,409);
  assert.equal((await call(off,f.actor,{method:'POST',headers,body:{mode:'manual_turn',action:'close',authorizationRef:a.authorizationRef}})).code,200);
  assert.equal((await call(productionEnv,f.actor,{method:'POST',headers,body:{mode:'manual_turn',action:'execute',authorizationRef:a.authorizationRef,fetchImpl:'override'}})).code,400);
});
test('production mode excluded from explicit retry before any retry workflow',async()=>{
  const f=productionMemory(),a=await prepare(f);await execute(f.db,a.authorizationRef,f.actor,options);
  const r=await inspectExplicitRetry(f.db,f.db.tables.shadow_ai_runs[0].id,{loadTurns:()=>assert.fail('scan')});assert.equal(r.reason,'manual_turn_retry_not_authorized');
});
test('legacy row does not fabricate persisted safety provenance',async()=>{
  const f=productionMemory(),a=await prepare(f);await execute(f.db,a.authorizationRef,f.actor,options);
  delete f.db.tables.shadow_ai_runs[0].telemetry_json.manual_turn.message_safety;
  const r=await read(f.db,a.authorizationRef,f.actor,off);assert.equal(r.certified,false);assert.equal(r.conversation_action.message_safe,null);
});
test('completed with missing receipt is not certified; another admin can close but cannot execute',async()=>{
  const f=productionMemory(),a=await prepare(f),other={id:'other-admin',role_id:'admin',active:true};f.db.tables.profiles.push(other);
  const available=await read(f.db,a.authorizationRef,other,productionEnv);assert.equal(available.capabilities.execute,false);assert.equal(available.capabilities.close,true);
  await assert.rejects(()=>execute(f.db,a.authorizationRef,other,options),/admin_required/);
  await execute(f.db,a.authorizationRef,f.actor,options);
  f.db.tables.shadow_ai_runs[0].telemetry_json.manual_turn.rounds=[];
  const r=await read(f.db,a.authorizationRef,f.actor,off);assert.equal(r.status,'completed');assert.equal(r.certified,false);
});
test('captured snapshot changes after provider cause fail-closed before 3A/3B',async()=>{
  const f=productionMemory(),a=await prepare(f);let n=0;
  const r=await execute(f.db,a.authorizationRef,f.actor,{...options,fetchImpl:async()=>{n++;f.db.tables.shadow_messages[0].sanitized_text='changed';return syntheticResponse();}});
  assert.equal(n,1);assert.equal(r.status,'error');assert.equal(r.telemetry.failure.error_code,'manual_input_changed');assert.equal(r.decision_persisted,false);
});
test('general dashboard excludes prod mode; UI has separate close without flight lock',async()=>{
  const api=await readFile(new URL('../pages/api/operaciones/shadow-coordinator.js',import.meta.url),'utf8');
  assert.match(api,/manual_prod_one_turn/);assert.match(api,/manual-prod-one-turn-v1/);
  const ui=await readFile(new URL('../components/ManualShadowTurnReview.js',import.meta.url),'utf8');assert.match(ui,/closeFlight/);assert.match(ui,/capabilities\?\.authorize!==true/);
});
for(const stage of ['final_payload_rejected','serialized_body_rejected'])test(`prod ${stage}: zero reservations/provider/tools/3B`,async()=>{
  const original=JSON.stringify,f=productionMemory(),env={...productionEnv};let calls=0;
  try{
    if(stage==='final_payload_rejected')env.SHADOW_AI_MODEL='10000000-1000-4000-8000-100000000001';
    else JSON.stringify=(v,...args)=>v?.max_tokens===1400?original({...v,residual:'10000000-1000-4000-8000-100000000001'},...args):original(v,...args);
    const a=await authorize(f.db,f.messageRef,f.actor,env);
    const r=await execute(f.db,a.authorizationRef,f.actor,{env,fetchImpl:async()=>{calls++;return syntheticResponse();}});
    assert.equal(calls,0);assert.equal(r.reserved_transmissions,0);assert.equal(r.certified,false);assert.ok(r.closed_at);
    assert.equal(r.telemetry.rounds[0].receipt.privacy_failure_code,stage);assert.equal(r.telemetry.rounds[0].receipt.provider_invoked,false);
    assert.equal(r.telemetry.tools.length,0);assert.equal(r.conversation_action_persisted,false);
  }finally{JSON.stringify=original;}
});
test('prod tool write attempt stopped before DB mutation, no 3B or second provider round',async()=>{
  const f=productionMemory(),a=await prepare(f);let calls=0;
  const r=await execute(f.db,a.authorizationRef,f.actor,{...options,fetchImpl:async(_u,{body})=>{
    calls++;const context=JSON.parse(JSON.parse(body).messages[0].content);
    return syntheticResponse({...manualDecision,proposedToolCalls:[{tool:'resolve_contact_identity',arguments:[{key:'respondContactId',value:context.metadata.respondContactId}],reason:'Consultar identidad'}]});
  },executeTool:async db=>db.from('respond_identity_audit').insert({event_type:'forbidden'})});
  assert.equal(calls,1);assert.equal(r.status,'error');assert.equal(r.telemetry.failure.error_code,'manual_tool_write_forbidden');
  assert.equal(r.conversation_action_persisted,false);assert.equal(f.db.writes.filter(w=>w.table==='respond_identity_audit').length,0);
});
