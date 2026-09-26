import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createHistoricalReplayHandler } from "../pages/api/operaciones/shadow-historical-replay.js";
import { isReplayRetryAdmin, validReplayRetryRequest, prepareHistoricalReplayRetry } from "../lib/shadow/ai/historicalReplayAttempts.js";
import { sanitizedOutputPrivacyDiagnostics } from "../lib/shadow/ai/outputPrivacyDiagnostics.js";
import { executeHistoricalReplayCase } from "../lib/shadow/ai/historicalReplay.js";

const id = (n) => `aa000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor = { id: id(1), active: true, role_id: "admin" };
const request = { action: "prepare_retry", caseId: id(10), parentAttemptId: null, authorization: "explicit_admin_retry" };
const receipt = { final_payload_verified: true, serialized_body_verified: true, privacy_stage: "final_model_privacy", output_mode: "anthropic_json_schema", provider_invoked: true };
const original = () => ({ id:id(10), case_ref:"original-ref", status:"error", case_domain:"administrative_pending", occurred_at:"2026-09-22T12:00:00Z", turn_snapshot:{ sanitizedText:"Consulta sintética",envelope:{sanitizedText:"Consulta sintética"} }, temporal_grounding:"current_state", identity_grounding:"current_canonical_mapping", error_code:"pre_model_sanitization_blocked", input_tokens:5630, output_tokens:701, result_safe:{ providerModels:["synthetic-old"], providerModelStatus:"reported", privacy_checks:[receipt], outputDiagnostics:{ outputStage:"final_model_privacy" } } });
// PostgREST contract double; actual PostgreSQL locking is tested separately.
function database() {
  const tables = { shadow_historical_replay_cases:[original()], shadow_historical_replay_attempts:[], shadow_historical_replay_cohorts:[], shadow_historical_replay_reviews:[] };
  const writes=[]; let serial=20;
  return { tables, writes, async rpc(name,args) {
    assert.equal(name,"prepare_historical_replay_retry");
    const root=tables.shadow_historical_replay_cases.find(r=>r.id===args.p_case_id);
    const parent=args.p_parent_attempt_id?tables.shadow_historical_replay_attempts.find(r=>r.id===args.p_parent_attempt_id&&r.case_id===root?.id):root;
    if (!parent || parent.status!=="error") return {error:{message:"replay_retry_requires_error"}};
    let child=tables.shadow_historical_replay_attempts.find(r=>r.case_id===root.id&&r.parent_attempt_id===args.p_parent_attempt_id);
    const created=!child;
    if (!child) { child={id:id(++serial),case_id:root.id,parent_attempt_id:args.p_parent_attempt_id,attempt_ref:serial.toString(16).padStart(32,"0"),attempt_number:(parent.attempt_number||1)+1,status:"pending",result_safe:null,input_tokens:null,output_tokens:null}; tables.shadow_historical_replay_attempts.push(child); writes.push({table:"shadow_historical_replay_attempts",insert:structuredClone(child)}); }
    return {data:{id:child.id,attemptRef:child.attempt_ref,attemptNumber:child.attempt_number,status:child.status,created}};
  }, from(table) {
    const filters=[]; let single=false,payload,limit;
    const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},order(){return q;},limit(n){limit=n;return q;},maybeSingle(){single=true;return q;},update(p){payload=p;return q;},
      then(ok,fail){return Promise.resolve().then(()=>{let rows=(tables[table]||[]).filter(r=>filters.every(f=>f(r)));if(payload){writes.push({table,payload:structuredClone(payload)});rows.forEach(r=>Object.assign(r,structuredClone(payload)));}if(limit)rows=rows.slice(0,limit);return {data:structuredClone(single?rows[0]||null:rows),error:null};}).then(ok,fail);}};return q;
  }};
}
function api(db, options={}) {
  const handler=createHistoricalReplayHandler({createAdmin:()=>db,authorize:async()=>actor,sameOrigin:()=>true,env:{},executeCase:async()=>{throw new Error("provider must not run");},...options});
  return async (body,method="POST")=>{const res={setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=JSON.parse(JSON.stringify(v));return this;}};await handler({method,headers:{},body},res);return res;};
}

test("creation from error: separate pending child, zero execution, exact original unchanged",async()=>{
  const db=database(), before=JSON.stringify(db.tables.shadow_historical_replay_cases);
  const response=await api(db)(request);assert.equal(response.statusCode,201);assert.equal(response.body.attemptNumber,2);
  assert.equal(db.tables.shadow_historical_replay_attempts[0].result_safe,null);
  assert.equal(JSON.stringify(db.tables.shadow_historical_replay_cases),before);
  assert.deepEqual(db.writes.map(w=>w.table),["shadow_historical_replay_attempts"]);
});
for(const status of ["pending","running","completed","not_evaluable"]) test(`retry from ${status} fails without writes/provider`,async()=>{
  const db=database();db.tables.shadow_historical_replay_cases[0].status=status;
  assert.equal((await api(db)(request)).statusCode,409);assert.equal(db.writes.length,0);
});
for(const profile of [null,{...actor,role_id:"asesor"},{...actor,role_id:"coord_operaciones"},{...actor,active:false},{...actor,active:undefined}]) test(`reject unauthorized actor ${profile?.role_id}/${profile?.active}`,async()=>{
  const db=database();assert.equal((await api(db,{authorize:async()=>profile})(request)).statusCode,403);assert.equal(db.writes.length,0);
  assert.equal(isReplayRetryAdmin(profile),false);
});
test("invalid same origin rejected before DB",async()=>{const db=database();assert.equal((await api(db,{sameOrigin:()=>false})(request)).statusCode,403);assert.equal(db.writes.length,0);});
for(const body of [{...request,authorization:null},{...request,caseId:"arbitrary"},{...request,caseId:[id(10)]},{...request,parentAttemptId:"arbitrary"},{...request,parentAttemptId:[id(21)]},{...request,runtime:"invented"},{...request,status:"pending"}]) test(`invalid explicit retry ${JSON.stringify(body)}`,()=>assert.equal(validReplayRetryRequest(body),false));
test("concurrent duplicate submissions return same child, never auto-execute",async()=>{
  const db=database(), endpoint=api(db);const results=await Promise.all([endpoint(request),endpoint(request)]);
  assert.deepEqual(results.map(r=>r.statusCode),[201,200]);assert.equal(results[0].body.attemptId,results[1].body.attemptId);assert.equal(db.writes.length,1);
});
test("RPC failures never expose a database exception or sensitive detail",async()=>{
  const result=await prepareHistoricalReplayRetry({rpc:async()=>({error:{message:"alice@example.com ref_private UUID secret"}})},actor,request);
  assert.deepEqual(result,{status:409,body:{ok:false,error:"replay_retry_creation_failed"}});
});
test("uncertain RPC response fails closed without provider or a second creation",async()=>{
  let calls=0;const result=await prepareHistoricalReplayRetry({rpc:async()=>{calls++;return {data:{id:id(21),attemptRef:"a".repeat(32),attemptNumber:2,created:true,status:"unexpected"}};}},actor,request);
  assert.equal(calls,1);assert.deepEqual(result,{status:409,body:{ok:false,error:"replay_retry_creation_uncertain"}});
});
test("child execute uses same snapshot/reduced runner; own receipts, model, usage and result; no parent overwrite",async()=>{
  const db=database(), before=JSON.stringify(db.tables.shadow_historical_replay_cases);let calls=0;
  const endpoint=api(db,{executeCase:async(_db,replayCase,options)=>{
    calls++;assert.deepEqual(replayCase.envelope,original().turn_snapshot.envelope);assert.equal(options.useReducedOutputSchema,true);
    return {operationalResolution:{case_status:"synthetic",would_resolve_without_human:false},conversationAction:{conversation_action:"human_handoff",proposed_message:null,requires_human:true,auto_send_eligible:false,blocked_reason:"financial_sensitive"},tools:["synthetic_read_only"],evidence:[],providerModels:["synthetic-new"],providerModelStatus:"reported",providerRequestRefs:[],privacyChecks:[receipt,receipt],inputTokens:7,outputTokens:3,messageSafe:true,latencyMs:42};
  }});
  const child=(await endpoint(request)).body.attemptId;
  const results=await Promise.all([endpoint({action:"execute_one",caseId:id(10),attemptId:child}),endpoint({action:"execute_one",caseId:id(10),attemptId:child})]);
  assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);assert.equal(calls,1);
  assert.equal(JSON.stringify(db.tables.shadow_historical_replay_cases),before);
  const get=await endpoint(null,"GET"), root=get.body.cases[0], attempt=root.attempts[0];
  assert.equal(root.attempt_number,1);assert.equal(root.status,"error");assert.equal(root.input_tokens,5630);assert.equal(root.privacy_checks.length,1);
  assert.equal(attempt.attempt_number,2);assert.equal(attempt.status,"completed");assert.equal(attempt.input_tokens,7);assert.equal(attempt.privacy_checks.length,2);assert.deepEqual(attempt.result_safe.providerModels,["synthetic-new"]);assert.equal(attempt.parent_ref,root.case_ref);
  assert.equal(attempt.error_code,undefined);assert.equal(root.can_retry,false);assert.equal(attempt.can_retry,false);assert.equal(get.body.metrics.total,1);
});
test("failed child preserves own diagnostic; next explicit action targets that error, not running/completed",async()=>{
  const db=database(),endpoint=api(db,{executeCase:async()=>{const error=new Error("synthetic_error");error.historicalReplayTelemetry={privacyChecks:[receipt],providerModels:["synthetic-new"],inputTokens:10,outputTokens:2,outputStage:"output_reference_decode",outputPrivacy:{reason:"unissued_model_reference",location:"tool_argument"}};throw error;}});
  const child=(await endpoint(request)).body.attemptId;
  assert.equal((await endpoint({action:"execute_one",caseId:id(10),attemptId:child})).statusCode,422);
  const data=(await endpoint(null,"GET")).body.cases[0];assert.equal(data.can_retry,false);assert.equal(data.attempts[0].can_retry,true);
  assert.equal(data.attempts[0].result_safe.outputDiagnostics.outputPrivacy.reason,"unissued_model_reference");assert.equal(data.result_safe.outputDiagnostics.outputPrivacy,undefined);
  const priorBytes=JSON.stringify(db.tables.shadow_historical_replay_attempts[0]);
  const next=await endpoint({...request,parentAttemptId:child});assert.equal(next.body.attemptNumber,3);assert.equal(next.statusCode,201);
  assert.equal(JSON.stringify(db.tables.shadow_historical_replay_attempts[0]),priorBytes);
  assert.equal(db.tables.shadow_historical_replay_attempts[1].result_safe,null);
});
test("attempt execution refuses coord_operaciones and cross-case IDs",async()=>{
  const db=database(),child=(await api(db)(request)).body.attemptId;
  assert.equal((await api(db,{authorize:async()=>({...actor,role_id:"coord_operaciones"})})({action:"execute_one",caseId:id(10),attemptId:child})).statusCode,403);
  assert.equal((await api(db)({action:"execute_one",caseId:id(11),attemptId:child})).statusCode,409);
});
test("existing executor still blocks retry with Replay provider OFF; original telemetry never leaks into child",async()=>{
  const db=database(),endpoint=api(db,{env:{SHADOW_HISTORICAL_REPLAY_ENABLED:"true",SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED:"false"},executeCase:executeHistoricalReplayCase});
  const child=(await endpoint(request)).body.attemptId;
  assert.equal((await endpoint({action:"execute_one",caseId:id(10),attemptId:child})).statusCode,422);
  const attempt=(await endpoint(null,"GET")).body.cases[0].attempts[0];
  assert.equal(attempt.error_code,"historical_replay_anthropic_disabled");assert.deepEqual(attempt.privacy_checks,[]);assert.deepEqual(attempt.result_safe.providerModels,[]);assert.equal(attempt.input_tokens,null);
});
test("GET re-sanitizes each attempt's diagnostics and receipts independently",async()=>{
  const db=database(),endpoint=api(db),child=(await endpoint(request)).body.attemptId;
  Object.assign(db.tables.shadow_historical_replay_attempts[0],{status:"error",result_safe:{privacy_checks:[{...receipt,body:"sensitive-not-allowed"}],outputDiagnostics:{outputStage:"output_reference_decode",outputPrivacy:{reason:"unissued_model_reference",location:"tool_argument",value:"sensitive-not-allowed"},path:"sensitive-not-allowed"}}});
  const get=await endpoint(null,"GET"),attempt=get.body.cases[0].attempts.find(a=>a.id===child);
  assert.equal(JSON.stringify(attempt).includes("sensitive-not-allowed"),false);
  assert.deepEqual(attempt.result_safe.outputDiagnostics.outputPrivacy,{reason:"unissued_model_reference",location:"tool_argument"});
  assert.equal(get.body.cases[0].result_safe.outputDiagnostics.outputPrivacy,undefined);
});
test("coordinator GET retains original case but cannot see or create retries",async()=>{
  const db=database();await api(db)(request);
  const root=(await api(db,{authorize:async()=>({...actor,role_id:"coord_operaciones"})})(null,"GET")).body.cases[0];
  assert.equal(root.can_retry,false);assert.deepEqual(root.attempts,[]);assert.equal(root.status,"error");
});

const ui=fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js",import.meta.url),"utf8");
const action=ui.slice(ui.indexOf("const operateReplayAttempt ="),ui.indexOf("const reconcileClient ="));
function uiAction({profile=actor,confirm=true,session={access_token:"synthetic-fresh",expires_at:4102444800},fetcher=async()=>({ok:true,json:async()=>({ok:true})})}={}) {
  const calls=[],busy={current:false};
  const run=new Function("profile","historicalReplayBusy","replayAttemptInFlight","window","supabase","fetch","setHistoricalReplayBusy","setError","loadHistoricalReplay",`${action};return operateReplayAttempt;`)(profile,false,busy,{confirm:()=>confirm},{auth:{getSession:async()=>({data:{session}})}},async(...args)=>{calls.push(args);return fetcher(...args);},()=>{},()=>{},async()=>{});
  return {run,calls};
}
test("real UI action uses fresh session; rapid double click creates one request and no execution",async()=>{
  let release;const pending=new Promise(r=>{release=r;});const {run,calls}=uiAction({fetcher:()=>pending});
  const first=run("prepare_retry",{id:id(10)});await Promise.resolve();await run("prepare_retry",{id:id(10)});
  release({ok:true,json:async()=>({ok:true})});await first;
  assert.equal(calls.length,1);assert.equal(calls[0][1].headers.Authorization,"Bearer synthetic-fresh");assert.deepEqual(JSON.parse(calls[0][1].body),request);
});
for(const options of [{confirm:false},{session:null},{session:{access_token:"expired",expires_at:1}},{profile:{...actor,role_id:"asesor"}}]) test(`UI fail-closed ${JSON.stringify(options)}`,async()=>{const {run,calls}=uiAction(options);await run("prepare_retry",{id:id(10)});assert.equal(calls.length,0);});
test("UI network failure does not retry",async()=>{const {run,calls}=uiAction({fetcher:async()=>{throw new Error("network");}});await run("prepare_retry",{id:id(10)});assert.equal(calls.length,1);});
test("real JSX labels original error and linked retry separately and binds separate explicit actions",()=>{
  const require=createRequire(import.meta.url),heading=ui.indexOf("Evaluación histórica 3B"),start=ui.lastIndexOf("<details",heading),end=ui.indexOf("</details>",heading)+10;
  const names=["card","brand","historicalReplay","historicalReplayBusy","historicalReplayPreview","historicalReplayTurnKeys","historicalReviewDrafts","operateHistoricalReplay","operateReplayAttempt","setHistoricalReplayTurnKeys","setHistoricalReviewDrafts","reviewHistoricalReplay","REPLAY_RATINGS","REPLAY_REASONS","sanitizedOutputPrivacyDiagnostics"];
  const compiled=require("next/dist/build/swc").transformSync(`export default function Section({${names.join(",")}}){return (${ui.slice(start,end)});}`,{jsc:{parser:{syntax:"ecmascript",jsx:true},transform:{react:{runtime:"automatic"}}},module:{type:"commonjs"}}).code;
  const mod={exports:{}};new Function("require","module","exports",compiled)(require,mod,mod.exports);const calls=[];
  const tree=mod.exports.default({card:{},brand:{},historicalReviewDrafts:{},sanitizedOutputPrivacyDiagnostics,operateReplayAttempt:(...args)=>calls.push(args),historicalReplay:{cases:[{...original(),attempt_number:1,attempts:[{id:id(21),case_id:id(10),case_ref:"original-ref",parent_ref:"original-ref",attempt_ref:"retry-ref",attempt_number:2,status:"pending",input_tokens:null,output_tokens:null}]}]}});
  const html=require("react-dom/server").renderToStaticMarkup(tree);assert.match(html,/Intento 1: error/);assert.match(html,/Intento 2: pending/);assert.match(html,/anterior original-ref/);assert.match(html,/Tokens:<\/strong> desconocido\/desconocido/);
  const nodes=(n)=>!n||typeof n!=="object"?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];nodes(tree).find(n=>n.type==="button"&&n.props.children==="Ejecutar este replay").props.onClick();assert.equal(calls.length,1);assert.equal(calls[0][0],"execute_one");assert.equal(calls[0][1].id,id(21));
});
