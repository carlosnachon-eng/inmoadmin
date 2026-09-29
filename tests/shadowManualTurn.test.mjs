import test from "node:test";
import assert from "node:assert/strict";
import { authorizeManualTurn,executeManualTurn,readManualTurn,readManualTurnForMessage } from "../lib/shadow/ai/manualTurn.js";
import { MANUAL_TURN_OFF_GATES,assertManualTurnDev,assertManualTurnContext,withManualTurnContext,readOnlyShadowDatabase } from "../lib/shadow/ai/manualTurnContext.js";
import { createManualTurnHandler, manualTurnSameOrigin } from "../lib/shadow/ai/manualTurnApi.js";
import { buildReducedAnthropicDecisionSchema } from "../lib/shadow/ai/reducedOutputSchema.js";
import { manualMemory,manualEnv,manualDecision,syntheticResponse } from "./helpers/manualTurnFixture.mjs";
import { safeManualTelemetry } from "../lib/shadow/ai/manualTurnTelemetry.js";

async function run(f,options={}){const a=await authorizeManualTurn(f.db,f.messageRef,f.actor,manualEnv);return executeManualTurn(f.db,a.authorizationRef,f.actor,{env:manualEnv,fetchImpl:async()=>syntheticResponse(),...options});}
test("manual happy path persists decision + 3A + 3B on same run and requires human review",async()=>{
  const f=manualMemory();let calls=0;
  const result=await run(f,{fetchImpl:async(_url,init)=>{calls++;const body=JSON.parse(init.body);assert.deepEqual(body.output_config.format.schema,buildReducedAnthropicDecisionSchema());assert.doesNotMatch(init.body,/123456|synthetic-only|manual-turn-captured/);return syntheticResponse();}});
  assert.equal(result.status,"completed");assert.equal(result.certified,true);assert.ok(calls<=2);assert.equal(result.human_review_required,true);assert.equal(result.outbound_authorized,false);
  assert.equal(f.db.tables.shadow_ai_decisions[0].ai_run_id,f.db.tables.shadow_conversation_actions[0].ai_run_id);
  assert.ok(result.telemetry.rounds.every(r=>r.receipt.final_payload_verified&&r.receipt.serialized_body_verified&&r.receipt.provider_invoked));
  assert.equal(result.telemetry.rounds[0].model,"claude-haiku-4-5-20251001");
  assert.ok(f.db.writes.every(w=>["shadow_ai_runs","shadow_ai_decisions","shadow_conversation_actions"].includes(w.table)));
});
test("double click creates one run; terminal error/completed cannot invoke again",async()=>{
  const f=manualMemory(),a=await authorizeManualTurn(f.db,f.messageRef,f.actor,manualEnv);let calls=0;
  const opts={env:manualEnv,fetchImpl:async()=>{calls++;return syntheticResponse();}};
  await Promise.all([executeManualTurn(f.db,a.authorizationRef,f.actor,opts),executeManualTurn(f.db,a.authorizationRef,f.actor,opts)]);
  const count=calls;await executeManualTurn(f.db,a.authorizationRef,f.actor,opts);
  assert.equal(f.db.tables.shadow_ai_runs.length,1);assert.equal(calls,count);
  await assert.rejects(()=>authorizeManualTurn(f.db,f.messageRef,f.actor,manualEnv),/storage_unavailable/);
});
test("snapshot change consumes zero authorization and invokes no model",async()=>{
  const f=manualMemory(),a=await authorizeManualTurn(f.db,f.messageRef,f.actor,manualEnv);
  f.db.tables.shadow_messages[0].sanitized_text="Otra solicitud";
  await assert.rejects(()=>executeManualTurn(f.db,a.authorizationRef,f.actor,{env:manualEnv,fetchImpl:()=>assert.fail("provider")}),/storage_unavailable/);
  assert.equal(f.db.tables.shadow_ai_runs.length,0);
});
for(const gate of MANUAL_TURN_OFF_GATES)test(`manual isolation requires ${gate}=false`,()=>{
  assert.throws(()=>assertManualTurnDev({...manualEnv,[gate]:"true"}),/isolation/);
  assert.throws(()=>assertManualTurnDev({...manualEnv,[gate]:undefined}),/isolation/);
});
for(const patch of [{VERCEL_ENV:"production"},{VERCEL_ENV:"preview"},{VERCEL:"1"},{NEXT_PUBLIC_SUPABASE_URL:"https://bnzrnizrmonjxlktbhlp.supabase.co"},{SHADOW_AI_OUTPUT_MODE:"text_json_local"}])test(`DEV pinned ${JSON.stringify(patch)}`,()=>assert.throws(()=>assertManualTurnDev({...manualEnv,...patch}),/isolation/));
test("capability cannot be forged or reused",async()=>{let cap;assert.throws(()=>assertManualTurnContext({}));await withManualTurnContext(manualEnv,async c=>{cap=c;assertManualTurnContext(c);});assert.throws(()=>assertManualTurnContext(cap));});
for(const method of ["insert","update","upsert","delete","rpc"])test(`tool client denies ${method} before DB call`,()=>{
  const f=manualMemory(),db=readOnlyShadowDatabase(f.db);
  assert.throws(()=>method==="rpc"?db.rpc("anything"):db.from("profiles")[method]({}),/manual_tool_write_forbidden/);
  assert.equal(f.db.writes.length,0);
});
test("contact tool uses issued alias and audit:false; two privacy checked rounds",async()=>{
  const f=manualMemory();let n=0;
  const result=await run(f,{fetchImpl:async(_u,init)=>{const context=JSON.parse(JSON.parse(init.body).messages[0].content);const d=structuredClone(manualDecision);if(++n===1)d.proposedToolCalls=[{tool:"resolve_contact_identity",arguments:[{key:"respondContactId",value:context.metadata.respondContactId}],reason:"Consultar identidad"}];return syntheticResponse(d);}});
  assert.equal(n,2);assert.equal(result.certified,true);assert.ok(result.telemetry.tools.some(t=>t.name==="resolve_contact_identity"&&t.ok));
  assert.equal(f.db.writes.filter(w=>w.table==="respond_identity_audit").length,0);
});
for(const [label,fetchImpl,stage] of [
  ["invalid schema",async()=>syntheticResponse({}),"structured_validation"],
  ["raw reference",async()=>syntheticResponse({...manualDecision,proposedToolCalls:[{tool:"resolve_contact_identity",arguments:[{key:"respondContactId",value:"123456"}],reason:"Consultar"}]}),"output_privacy_validation"],
  ["HTTP failure",async()=>({ok:false,status:400,headers:{get:()=>null},json:async()=>({error:{type:"invalid_request_error",message:"private@example.com"}})}),"provider_http"],
])test(`${label}: distinct failure, no tools/3B, no retry`,async()=>{
  const f=manualMemory();let calls=0;const r=await run(f,{fetchImpl:async(...args)=>{calls++;return fetchImpl(...args);}});
  assert.equal(r.status,"error");assert.equal(r.certified,false);assert.equal(r.telemetry.failure.outputStage,stage);assert.equal(calls,1);
  assert.equal(r.telemetry.tools.length,0);assert.equal(r.conversation_action_persisted,false);assert.doesNotMatch(JSON.stringify(r),/private@example|123456|ref_[a-f0-9]/);
});
test("3B failure preserves 3A but never certifies completed",async()=>{
  const f=manualMemory();const r=await run(f,{persistManualAction:async()=>{throw new Error("synthetic");}});
  assert.equal(r.status,"error");assert.equal(r.operational_resolution_persisted,true);assert.equal(r.conversation_action_persisted,false);assert.equal(r.certified,false);assert.equal(r.telemetry.failure.outputStage,"3B");
});
test("no_message reaches 3B and persists silence without sending",async()=>{
  const f=manualMemory({text:"Gracias."});
  const r=await run(f,{fetchImpl:async()=>syntheticResponse({...manualDecision,intent:"no_determinado",conversationalResponseParts:{acknowledgement:"Gracias.",verifiedFactReferences:[],clarificationQuestion:null,escalationMessage:null}})});
  assert.equal(r.certified,true);assert.equal(r.conversation_action.conversation_action,"no_message");assert.equal(r.conversation_action.proposed_message,null);
});
test("ask_missing_information retains real 3B eligibility and no outbound authority",async()=>{
  const f=manualMemory({text:"Hay una fuga."});const r=await run(f);
  assert.equal(r.certified,true);assert.equal(r.conversation_action.conversation_action,"ask_missing_information");assert.equal(r.conversation_action.message_safe,true);assert.equal(r.outbound_authorized,false);
});
test("timeout has no retry and cannot persist completed",async()=>{
  const f=manualMemory();let calls=0;
  const r=await run(f,{env:{...manualEnv,SHADOW_AI_ANTHROPIC_ATTEMPT_TIMEOUT_MS:"5"},fetchImpl:async(_u,{signal})=>{calls++;return new Promise((_ok,reject)=>signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true}));}});
  assert.equal(calls,1);assert.equal(r.status,"timeout");assert.equal(r.telemetry.failure.outputStage,"timeout");assert.equal(r.certified,false);
  assert.equal(r.telemetry.rounds[0].receipt.final_payload_verified,true);
  assert.equal(r.telemetry.rounds[0].receipt.serialized_body_verified,true);
  assert.equal(r.telemetry.rounds[0].receipt.provider_invoked,true);
  assert.equal(r.telemetry.rounds[0].model,null);assert.equal(r.telemetry.rounds[0].input_tokens,null);
});
test("mutating tool implementation is contained before any write or 3B",async()=>{
  const f=manualMemory();const r=await run(f,{executeTool:async(db)=>db.from("respond_identity_audit").insert({sensitive:"not-written"})});
  assert.equal(r.status,"error");assert.equal(r.telemetry.failure.error_code,"manual_tool_write_forbidden");assert.equal(r.conversation_action_persisted,false);
  assert.equal(f.db.writes.filter(w=>w.table==="respond_identity_audit").length,0);
});
test("bounded loader refuses truncated context and attachments without interpreting them",async()=>{
  for(const mode of ["limit","attachment"]){const f=manualMemory();
    if(mode==="limit")f.db.tables.shadow_messages=Array.from({length:201},(_,i)=>({...f.db.tables.shadow_messages[0],id:i===200?f.messageId:`old-${i}`}));
    else f.db.tables.shadow_messages[0].attachment_metadata=[{type:"image",mimeType:"image/jpeg"}];
    await assert.rejects(()=>authorizeManualTurn(f.db,f.messageRef,f.actor,manualEnv),mode==="limit"?/context_limit/:/attachment_review/);
    assert.equal(f.db.rpcCount,0);
  }
});
test("GET never infers certification from completed alone",async()=>{
  const f=manualMemory(),a=await authorizeManualTurn(f.db,f.messageRef,f.actor,manualEnv);await executeManualTurn(f.db,a.authorizationRef,f.actor,{env:manualEnv,fetchImpl:async()=>syntheticResponse()});
  f.db.tables.shadow_conversation_actions=[];
  assert.equal((await readManualTurn(f.db,a.authorizationRef,f.actor)).certified,false);
});
test("diagnostic reprojection discards arbitrary data",()=>{
  assert.doesNotMatch(JSON.stringify(safeManualTelemetry({value:"secret",rounds:[{model:"private@example.com",receipt:{alias:"ref_abc"}}],failure:{outputStage:"output_reference_decode",outputPrivacy:{reason:"unissued_or_raw_model_reference",location:"tool_argument",value:"private"}}})),/secret|private|ref_abc/);
});
test("API admin/current-profile and same origin enforced before any work",async()=>{
  for(const [origin,role,active] of [["http://evil","admin",true],["http://127.0.0.1:3000","asesor",true],["http://127.0.0.1:3000","admin",false]]){
    const h=createManualTurnHandler({authorize:async()=>({role_id:role,active}),createAdmin:()=>assert.fail("DB"),env:manualEnv});
    const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.value=v;return this;}};
    await h({method:"POST",headers:{host:"127.0.0.1:3000",origin},body:{action:"authorize"}},res);assert.equal(res.code,403);
  }
});
test("browser same-origin GET without Origin is accepted only with matching referer and fetch metadata",()=>{
  const req={method:"GET",headers:{host:"127.0.0.1:3000",referer:"http://127.0.0.1:3000/coordinador-ia-sombra","sec-fetch-site":"same-origin"}};
  assert.equal(manualTurnSameOrigin(req),true);
  assert.equal(manualTurnSameOrigin({...req,method:"POST"}),false);
  assert.equal(manualTurnSameOrigin({...req,headers:{...req.headers,origin:"http://evil"}}),false);
  assert.equal(manualTurnSameOrigin({...req,headers:{...req.headers,referer:"http://evil"}}),false);
  assert.equal(manualTurnSameOrigin({...req,headers:{...req.headers,"sec-fetch-site":"cross-site"}}),false);
});
test("successful response with unknown usage remains unknown, not zero",async()=>{
  const f=manualMemory();const r=await run(f,{fetchImpl:async()=>{const response=syntheticResponse();const body=await response.json();delete body.usage;return {...response,json:async()=>body};}});
  assert.equal(r.certified,true);assert.equal(r.telemetry.rounds[0].input_tokens,null);assert.equal(f.db.tables.shadow_ai_runs[0].input_tokens,null);
});
for(const stage of ["final_payload_rejected","serialized_body_rejected"])test(`manual ${stage} blocks before provider, tools and 3B`,async()=>{
  const stringify=JSON.stringify,f=manualMemory(),env={...manualEnv};let calls=0;
  try {
    if(stage==="final_payload_rejected")env.SHADOW_AI_MODEL="10000000-1000-4000-8000-100000000001";
    else JSON.stringify=(v,...args)=>v?.max_tokens===1400?stringify({...v,syntheticResidual:"10000000-1000-4000-8000-100000000001"},...args):stringify(v,...args);
    const r=await run(f,{env,fetchImpl:async()=>{calls++;return syntheticResponse();}});
    assert.equal(r.certified,false);assert.equal(calls,0);assert.equal(r.telemetry.rounds[0].receipt.privacy_failure_code,stage);
    assert.equal(r.telemetry.rounds[0].receipt.provider_invoked,false);assert.equal(r.telemetry.tools.length,0);assert.equal(r.conversation_action_persisted,false);
  } finally {JSON.stringify=stringify;}
});
test("review can reload by selected opaque message ref without new authorization or execution",async()=>{
  const f=manualMemory();await run(f);const n=f.db.rpcCount;
  const r=await readManualTurnForMessage(f.db,f.messageRef,f.actor);
  assert.equal(r.certified,true);assert.equal(f.db.rpcCount,n);
  assert.equal((await readManualTurnForMessage(f.db,f.messageRef,{...f.actor,id:"other"})).status,"not_authorized");
});
test("manual structured tool/key diagnostics use the existing safe projection",async()=>{
  const f=manualMemory(),value="do-not-persist@example.invalid";
  const r=await run(f,{fetchImpl:async()=>syntheticResponse({...manualDecision,proposedToolCalls:[{tool:"find_properties",arguments:[{key:"respondContactId",value}],reason:"Consulta"}]})});
  assert.equal(r.status,"error");assert.equal(r.telemetry.failure.outputStage,"structured_validation");
  assert.equal(r.telemetry.failure.diagnosticCode,"reduced_arguments_key_not_allowed_for_tool");
  assert.deepEqual(r.telemetry.failure.structuredOutput,{tool:"find_properties",argument_key:"respondContactId"});
  assert.equal(r.telemetry.tools.length,0);assert.equal(r.conversation_action_persisted,false);assert.ok(!JSON.stringify(r).includes(value));
});
