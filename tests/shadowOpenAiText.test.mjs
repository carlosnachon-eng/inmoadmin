import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { textFixture, textEnv, textDecision, syntheticOpenAi } from "./helpers/openaiTextFixture.mjs";
import { startShadowAiStateMachine, continueShadowAiStateMachine } from "../lib/shadow/ai/stateMachine.js";
import { invokeOpenAiTextPhase3A } from "../lib/shadow/ai/phase3AGateway.js";
import { decodeReducedShadowAiDecision, buildReducedShadowDecisionSchema } from "../lib/shadow/ai/reducedOutputSchema.js";
import { REAL_SHADOW_AI_SYSTEM_PROMPT } from "../lib/shadow/ai/realPrompt.js";
import { knownAgentUsage } from "../lib/agentsV2/agentUsage.js";
import { loadAutoRealTurns, processNextAutoRealTurn } from "../lib/shadow/ai/autoReal.js";
import { inspectExplicitRetry } from "../lib/shadow/ai/explicitRetry.js";
import { bindVerifiedModelMessages, createModelPrivacyScope, serializeVerifiedOpenAiBody } from "../lib/shadow/ai/finalModelPrivacy.js";
import { REDUCED_SHADOW_TEXT_TOOL_GUIDE } from "../lib/shadow/ai/historicalReplayToolGuide.js";
import { modelPrivacyReceipt } from "../lib/shadow/ai/modelPrivacyTelemetry.js";
const start = (f,p,extra={}) => startShadowAiStateMachine(f.db,{messageId:f.messageId,envelope:f.envelope},{...f.options,fetchImpl:p.fetchImpl,...extra});
const finish = async (f,p) => {
  let result=await start(f,p);
  for(let n=0;n<2&&result.status==="awaiting_model_round";n++) result=await continueShadowAiStateMachine(f.db,result.runId,{...f.options,fetchImpl:p.fetchImpl});
  return result;
};

test("OpenAI exact body, reduced contract and accredited usage/cost; no native tools", async()=>{
  const f=textFixture(), p=syntheticOpenAi();
  const result=await invokeOpenAiTextPhase3A({admin:f.db,envelope:f.envelope,systemPrompt:REAL_SHADOW_AI_SYSTEM_PROMPT,modelOptions:{env:textEnv,fetchImpl:p.fetchImpl}});
  assert.deepEqual(decodeReducedShadowAiDecision(JSON.parse(result.text),result),textDecision());
  const body=JSON.parse(p.calls[0].body);
  assert.deepEqual(body.agent.text.format.schema,buildReducedShadowDecisionSchema());
  assert.deepEqual(body.agent.tools,[]); assert.equal(body.agent.multi_agent.enabled,false); assert.equal(body.environment.type,"none");
  assert.doesNotMatch(p.calls[0].body,/123456|ANTHROPIC|synthetic-only/);
  assert.match(p.contexts[0].metadata.respondContactId,/^ref_/);
  assert.equal(result.openai.usage.totalTokens,130); assert.equal(result.model,"gpt-6-luna");
  assert.equal(result.openai.estimated_cost_usd,0.0000232);
});

test("state machine persists decision + 3A + 3B and read-back, unknown != zero",async()=>{
  const f=textFixture(),p=syntheticOpenAi({usage:null,model:null});
  const r=await finish(f,p);
  assert.ok(["completed","blocked"].includes(r.status),JSON.stringify(r));
  const run=f.tables.shadow_ai_runs[0];
  assert.equal(run.telemetry_json.persistence.verified,true);
  assert.equal(f.tables.shadow_ai_decisions.length,1);assert.equal(f.tables.shadow_conversation_actions.length,1);
  assert.ok(f.tables.shadow_ai_decisions[0].decision_json.operational_resolution);
  assert.equal(run.input_tokens,null);assert.equal(run.output_tokens,null);assert.equal(run.estimated_cost_usd,null);
  assert.equal(run.telemetry_json.model_requests[0].model,null);assert.equal(run.telemetry_json.provider_retry_count,0);
  assert.equal(run.telemetry_json.anthropic_requests,undefined);
  assert.ok(f.db.writes.every(w=>["shadow_ai_runs","shadow_ai_decisions","shadow_conversation_actions"].includes(w.table)));
  assert.doesNotMatch(JSON.stringify(run),/ref_[a-f0-9]+_/);
});

for(const mode of ["timeout","uncertain_create","http","failed"]){
  test(`${mode}: fail closed, receipt durable, one session/no retries`,async()=>{
    const f=textFixture(),p=syntheticOpenAi({mode});f.options.env.SHADOW_AI_MODEL_TIMEOUT_MS="15";
    const r=await start(f,p);assert.equal(r.status,mode.includes("timeout")||mode==="uncertain_create"?"timeout":"error");
    const run=f.tables.shadow_ai_runs[0], receipt=run.telemetry_json.model_requests[0].receipt;
    assert.equal(receipt.final_payload_verified,true);assert.equal(receipt.serialized_body_verified,true);assert.equal(receipt.provider_invoked,true);
    assert.equal(run.input_tokens,mode==="failed"?100:null);
    assert.equal(f.tables.shadow_ai_decisions.length,0);assert.equal(f.tables.shadow_conversation_actions.length,0);
    assert.equal(p.sessions.length,1);
    await start(f,p); assert.equal(p.sessions.length,1); assert.equal(f.tables.shadow_ai_runs.length,1);
    if(mode==="timeout") assert.equal(run.telemetry_json.model_requests[0].cancellation,"requested");
    if(mode==="uncertain_create") assert.equal(run.telemetry_json.model_requests[0].cancellation,"uncertain");
    assert.equal((await inspectExplicitRetry(f.db,run.id)).reason,"openai_text_retry_not_authorized");
  });
}

for (const table of ["shadow_ai_decisions","shadow_conversation_actions"]) test(`${table} persistence failure is NOT certified`, async()=>{
  const f=textFixture(),p=syntheticOpenAi();f.db.failTable=table;
  const r=await finish(f,p);assert.equal(r.status,"error");assert.equal(f.tables.shadow_ai_runs[0].telemetry_json.persistence.verified,false);
  assert.equal(p.sessions.length,2);
});

test("simultaneous claims create one permanent run/session",async()=>{
  const f=textFixture(),p=syntheticOpenAi(); await Promise.all([start(f,p),start(f,p)]);
  assert.equal(f.tables.shadow_ai_runs.length,1);assert.equal(p.sessions.length,1);
});

test("failed final run read-back cannot leave a certified completed run",async()=>{
  const f=textFixture(),p=syntheticOpenAi(),from=f.db.from;
  f.db.from=table=>{
    const q=from(table),select=q.select;let projection;
    q.select=value=>{projection=value;return select(value);};
    const single=q.single;
    q.single=()=>table==="shadow_ai_runs"&&projection==="status,execution_state,telemetry_json"
      ?Promise.resolve({error:{code:"synthetic_readback_failure"},data:null}):single();
    return q;
  };
  const r=await finish(f,p);assert.equal(r.status,"error");
  assert.equal(f.tables.shadow_ai_runs[0].status,"error");
  assert.equal(f.tables.shadow_ai_runs[0].telemetry_json.persistence.verified,false);
  assert.equal(r.telemetry.failure.error_code,"text_result_persistence_failed");
  await start(f,p);assert.equal(p.sessions.length,2);
});

test("tool timeout records failure before stopping, with no 3B or provider retry",async()=>{
  const f=textFixture(),p=syntheticOpenAi();f.options.env.SHADOW_AI_TOOL_TIMEOUT_MS="5";
  const r=await start(f,p,{executeTool:()=>new Promise(()=>{})});
  assert.equal(r.status,"timeout");assert.equal(r.telemetry.failure.error_code,"tool_timeout");
  assert.equal(r.telemetry.tools.length,1);assert.equal(r.telemetry.tools[0].succeeded,false);
  assert.equal(f.tables.shadow_ai_decisions.length,0);assert.equal(f.tables.shadow_conversation_actions.length,0);
  assert.equal(p.sessions.length,1);
});

test("actual cron handler: authorized HTTP 200 completed/idle; no provider on unauthorized",async()=>{
  const f=textFixture(),p=syntheticOpenAi(),previousEnv={...process.env};
  const source=readFileSync(new URL("../pages/api/cron/shadow-ai-real-auto.js",import.meta.url),"utf8")
    .replace(/import \{ getAdminSupabase \}[^\n]+/,"const getAdminSupabase = () => globalThis.__shadowTextCronFixture.db;")
    .replace(/import \{ processNextAutoRealTurn \}[^\n]+/,"const processNextAutoRealTurn = globalThis.__shadowTextCronFixture.process;");
  globalThis.__shadowTextCronFixture={db:f.db,process:(db,options)=>processNextAutoRealTurn(db,{...options,fetchImpl:p.fetchImpl,reconcileOrigins:async()=>{}})};
  Object.assign(process.env,textEnv,{CRON_SECRET:"synthetic-cron"});
  try{
    const {default:handler}=await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}});
    const denied=response();await handler({method:"GET",headers:{}},denied);assert.equal(denied.code,401);assert.equal(p.sessions.length,0);
    const first=response();await handler({method:"GET",headers:{authorization:"Bearer synthetic-cron"}},first);
    assert.equal(first.code,200);assert.ok(["completed","blocked"].includes(first.data.status));
    const second=response();await handler({method:"GET",headers:{authorization:"Bearer synthetic-cron"}},second);
    assert.equal(second.code,200);assert.equal(second.data.status,"idle");assert.match(second.headers["Cache-Control"],/no-store/);
  }finally{
    delete globalThis.__shadowTextCronFixture;
    for(const key of Object.keys(process.env))if(!(key in previousEnv))delete process.env[key];
    Object.assign(process.env,previousEnv);
  }
});

for(const status of ["completed","error","timeout","running"])test(`historical Claude ${status} never reprocessed with different model/prompt`,async()=>{
  const f=textFixture(),p=syntheticOpenAi();const historic={id:"historic-synthetic",message_id:f.messageId,status,model:"claude-haiku-4-5-20251001",prompt_version:"older",telemetry_json:{turn_key:f.turnKey}};
  f.tables.shadow_ai_runs.push(historic);const before=JSON.stringify(historic);
  await start(f,p);assert.equal(p.sessions.length,0);assert.equal(JSON.stringify(historic),before);
  const loaded=await loadAutoRealTurns(f.db,{env:textEnv});assert.equal(loaded.turns.length,1);assert.notEqual(loaded.turns[0].disposition,"pending");
});

test("cron processing completed then idle with no second provider call",async()=>{
  const f=textFixture(),p=syntheticOpenAi();
  const options={env:textEnv,fetchImpl:p.fetchImpl,reconcileOrigins:async()=>{}};
  const first=await processNextAutoRealTurn(f.db,options); assert.ok(["completed","blocked"].includes(first.status),JSON.stringify(first));
  const second=await processNextAutoRealTurn(f.db,options);assert.equal(second.status,"idle");assert.ok(p.sessions.length<=2);
});

test("usage cached/reasoning are subsets; absent usage never invented",()=>{
  assert.equal(knownAgentUsage(null),null);assert.equal(knownAgentUsage({input_tokens:10}),null);
  assert.equal(knownAgentUsage({input_tokens:10,output_tokens:2,input_tokens_details:{cached_tokens:11}}),null);
  assert.deepEqual(knownAgentUsage({input_tokens:10,output_tokens:2}),{inputTokens:10,outputTokens:2,totalTokens:12,cachedInputTokens:null,reasoningTokens:null});
});

test("three fresh sessions, five tools per round ceiling, local continuity and fresh aliases",async()=>{
  const f=textFixture();
  for(const key of ["propertyId","contractId","paymentId","ticketId","keyId","ownerPaymentId"]) f.envelope.providerMetadata[key]="af000000-0000-4000-8000-000000000001";
  const requests=[[['find_properties','propertyId'],['find_active_contracts','contractId'],['get_payment_summary','paymentId'],['get_key_custody_status','keyId']],
    [['get_owner_liquidation_summary','ownerPaymentId']],[]];
  const p=syntheticOpenAi({decision:(ctx,n)=>({...textDecision(),proposedToolCalls:requests[n].map(([tool,key])=>({tool,arguments:[{key,value:ctx.metadata[key]}],reason:"Consulta verificable"}))})});
  const tools=[];
  const extra={executeTool:async(db,name,args)=>{
    for(const mutation of ["insert","update","upsert","delete"]) assert.throws(()=>db.from("properties")[mutation]({}),/manual_tool_write_forbidden/);
    assert.throws(()=>db.rpc("mutant",{}),/manual_tool_write_forbidden/);
    tools.push({name,args});return [];
  }};
  let r=await start(f,p,extra);
  while(r.status==="awaiting_model_round") r=await continueShadowAiStateMachine(f.db,r.runId,{...f.options,...extra,fetchImpl:p.fetchImpl});
  assert.equal(r.currentRound,3);assert.equal(p.sessions.length,3);assert.equal(tools.length,6);
  assert.equal(r.telemetry.tools.filter(t=>t.round_number===1).length,5);
  assert.equal(p.contexts[1].tools.length,5);assert.equal(p.contexts[2].tools.length,6);
  assert.equal(new Set(p.contexts.map(c=>c.metadata.respondContactId)).size,3);
  assert.ok(tools.some(t=>t.args.propertyId===f.envelope.providerMetadata.propertyId));
  assert.doesNotMatch(p.calls.map(c=>c.body||"").join(""),/af000000-0000|123456/);
  assert.doesNotMatch(JSON.stringify(f.tables.shadow_ai_runs),/ref_[a-z]+_\d+|reverseMap/);
  const again=await continueShadowAiStateMachine(f.db,r.runId,{...f.options,fetchImpl:p.fetchImpl});
  assert.notEqual(again.status,"awaiting_model_round");assert.equal(p.sessions.length,3);
});

for(const bad of ["raw","invented","wrong_type","prior_round"])test(`${bad} references fail closed before tool execution`,async()=>{
  const f=textFixture();f.envelope.providerMetadata.propertyId="af000000-0000-4000-8000-000000000001";let previousAlias;
  const p=syntheticOpenAi({decision:(ctx,n)=>{
    const d=textDecision();
    if(bad==="prior_round"&&n===0){previousAlias=ctx.metadata.respondContactId;return d;}
    d.proposedToolCalls=[{tool:"resolve_contact_identity",arguments:[{key:"respondContactId",value:bad==="raw"?"123456":bad==="invented"?"ref_inventado_1":bad==="wrong_type"?ctx.metadata.propertyId:previousAlias}],reason:"Verificar contexto"}];return d;
  }});
  const r=await finish(f,p);assert.equal(r.status,"error");
  assert.equal(r.telemetry.failure.outputStage,bad==="wrong_type"?"output_reference_decode":"output_privacy_validation");
  assert.ok(["model_reference_type_mismatch","unaliased_reference_field","unissued_model_reference","residual_internal_reference"].includes(r.telemetry.failure.outputPrivacy.reason),JSON.stringify(r.telemetry.failure));
  assert.equal(r.telemetry.tools.length,bad==="prior_round"?1:0);
});

for(const bad of ["not json",{...textDecision(),summary:"ref_inventado_1"}])test(`invalid output has no repair, tools or 3B: ${typeof bad}`,async()=>{
  const f=textFixture(),p=syntheticOpenAi({decision:bad});const r=await start(f,p);
  assert.equal(r.status,"error");assert.equal(p.sessions.length,1);assert.equal(r.telemetry.tools.length,0);assert.equal(f.tables.shadow_conversation_actions.length,0);
});

test("privacy verifies complete object and exact serialization, including late fields",()=>{
  const scope=createModelPrivacyScope();
  const messages=bindVerifiedModelMessages([{role:"system",content:`${REAL_SHADOW_AI_SYSTEM_PROMPT}\n\n${REDUCED_SHADOW_TEXT_TOOL_GUIDE}`},{role:"user",content:'{"message":"Consulta"}'}],scope);
  for(const value of ["af000000-0000-4000-8000-000000000001","persona@example.invalid","5523456789","cuenta 123456789012345678","sk-secret-with-sensitive-content"]){
    const body={input:"Consulta",metadata:{added:value}};
    assert.throws(()=>serializeVerifiedOpenAiBody(body,messages,"gpt-6-luna"),/pre_model_sanitization_blocked/);
  }
  const body={input:"Consulta"};
  assert.throws(()=>serializeVerifiedOpenAiBody(body,messages,"gpt-6-luna",stage=>{if(stage==="final_payload_verified")body.added="persona@example.invalid";}),/pre_model_sanitization_blocked/);
});

test("preload timeout has provider_invoked=false, no late call",async()=>{
  const f=textFixture(),p=syntheticOpenAi();const from=f.db.from;
  f.db.from=table=>table==="respond_identity_links"?new Proxy({then:()=>new Promise(()=>{})},{get:(t,k)=>k==="then"?t.then:()=>f.db.from(table)}):from(table);
  f.options.env.SHADOW_AI_DURABLE_DEADLINE_MS="10";
  const r=await start(f,p);assert.equal(r.status,"timeout");assert.equal(p.sessions.length,0);
  assert.equal(r.telemetry.model_requests[0].receipt.provider_invoked,false);
});

test("historical lookup is not limited to latest 1000 runs",async()=>{
  const f=textFixture();const loaded=await loadAutoRealTurns(f.db,{env:textEnv});
  f.tables.shadow_ai_runs.push({id:"historical",message_id:f.messageId,status:"error",model:"claude-old",created_at:"2026-01-01",telemetry_json:{turn_key:loaded.turns[0].turnKey}});
  for(let n=0;n<1005;n++)f.tables.shadow_ai_runs.push({id:`other-${n}`,created_at:"2026-12-01",status:"completed",telemetry_json:{}});
  const after=await loadAutoRealTurns(f.db,{env:textEnv});assert.equal(after.turns[0].disposition,"report_failed_no_retry");
});

test("unsafe outbound/R1 gates, missing OpenAI model/key or disabled 3B cause zero calls",async()=>{
  for(const override of [{SHADOW_ADMIN_WORK_R1_ENABLED:"true"},{SHADOW_ADMIN_OUTBOUND_ENABLED:"true"},{OPENAI_API_KEY:""},{OPENAI_ADMIN_AGENT_MODEL:""},{SHADOW_CONVERSATION_ACTIONS_ENABLED:"false"}]){
    const f=textFixture(),p=syntheticOpenAi();Object.assign(f.options.env,override);
    try{await start(f,p);}catch{}
    assert.equal(p.sessions.length,0);assert.equal(f.tables.shadow_ai_runs.length,0);
  }
});

test("media and historical support deliberately retained; no key/fallback in new transport",()=>{
  const source=readFileSync(new URL("../lib/shadow/ai/openaiTextTransport.js",import.meta.url),"utf8");
  assert.doesNotMatch(source,/ANTHROPIC_API_KEY|createAnthropic/);
});
