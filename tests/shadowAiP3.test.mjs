import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { shadowAiGuard, SHADOW_AI_LIMITS } from "../lib/shadow/ai/guards.js";
import { anthropicShadowAiDecisionJsonSchema, validateShadowAiDecision } from "../lib/shadow/ai/schema.js";
import { createAnthropicShadowResponse } from "../lib/shadow/ai/anthropic.js";
import { SHADOW_AI_QA_DATASET, evaluateShadowAiQa } from "../lib/shadow/ai/qaDataset.js";
import { READ_ONLY_SHADOW_TOOLS, SHADOW_TOOL_ARGUMENT_SCHEMAS } from "../lib/shadow/context.js";
import { runShadowAi } from "../lib/shadow/ai/runner.js";

const devEnv = { SHADOW_AI_ENABLED:"true", SHADOW_AI_ALLOW_REAL_MESSAGES:"false", SHADOW_OUTBOUND_ENABLED:"false", SUPABASE_ENVIRONMENT:"dev", NEXT_PUBLIC_SUPABASE_URL:"https://hjfwjnejbcpmknvfpdcq.supabase.co", ANTHROPIC_API_KEY:"fixture" };
const synthetic = { provider:"synthetic", providerMetadata:{syntheticScenario:"p3-01"} };
const validDecision={intent:"mantenimiento",secondaryIntents:[],urgency:"normal",summary:"Fuga",entitiesMentioned:[],informationNeeded:[],proposedToolCalls:[],contextAssessment:"Sin contexto",proposedAction:"Escalar",proposedResponse:"Lo revisará el equipo.",confidence:.8,requiresHuman:true,escalationReason:"Revisión",safetyFlags:[]};
function fakeAiDb(initialRuns=[], options={}){
  const writes=[]; const runs=(Array.isArray(initialRuns) ? initialRuns : initialRuns ? [initialRuns] : []).map((row,index)=>({attempt_number:index+1,created_at:`2026-08-20T10:0${index}:00Z`,...row}));
  const decisions=[...(options.decisions || [])]; let nextRun=runs.length+1;
  return {writes,runs,decisions,from(table){let action="select",payload,filter={};
    const q={select(){return q;},eq(column,value){if(column!=="idempotency_key")filter[column]=value;return q;},order(){return q;},limit(){return q;},
      maybeSingle:async()=>{const rows=table==="shadow_ai_decisions" ? decisions : runs;const found=rows.find(row=>Object.entries(filter).every(([key,value])=>row[key]===value));return{data:found||null,error:null};},
      insert(value){action="insert";payload=value;writes.push({table,action,payload});return q;},
      update(value){action="update";payload=value;writes.push({table,action,payload});return q;},
      single:async()=>{if(table==="shadow_ai_runs"&&action==="insert"){if(options.insertError)return{data:null,error:options.insertError};const row={id:`run-${nextRun++}`,created_at:new Date().toISOString(),...payload};runs.unshift(row);return{data:{id:row.id},error:null};}return{data:{id:"fixture"},error:null};},
      then(resolve){if(action!=="select")return resolve({data:null,error:null});const rows=(table==="shadow_ai_runs"?runs:decisions).filter(row=>Object.entries(filter).every(([key,value])=>row[key]===value));return resolve({data:rows,error:null});}}; return q;
  }};
}

test("guard P3 requiere DEV exacto, flag, key y mensaje sintético", () => {
  assert.equal(shadowAiGuard(synthetic, devEnv).allowed,true);
  assert.equal(shadowAiGuard(synthetic,{...devEnv,SHADOW_AI_ENABLED:"false"}).status,"disabled");
  assert.equal(shadowAiGuard(synthetic,{...devEnv,NEXT_PUBLIC_SUPABASE_URL:"https://bnzrnizrmonjxlktbhlp.supabase.co"}).status,"blocked_environment");
  assert.equal(shadowAiGuard({provider:"respond_admin",providerMetadata:{}},devEnv).status,"blocked_real_message");
  assert.equal(shadowAiGuard(synthetic,{...devEnv,SHADOW_OUTBOUND_ENABLED:"true"}).status,"blocked_outbound");
});

test("schema estructurado rechaza texto libre y campos desconocidos", () => {
  assert.throws(()=>validateShadowAiDecision("texto"),/invalid_structured_output/);
  assert.equal(validateShadowAiDecision(validDecision),validDecision);
  assert.throws(()=>validateShadowAiDecision({...validDecision,sql:"delete"}),/invalid_structured_output/);
  assert.throws(()=>validateShadowAiDecision({...validDecision,summary:"x".repeat(501)}),/invalid_structured_output/);
  assert.throws(()=>validateShadowAiDecision({...validDecision,entitiesMentioned:["x".repeat(121)]}),/invalid_structured_output/);
});

test("contrato Anthropic usa output_config vigente y elimina constraints no soportados", async()=>{
  let request;
  const response=await createAnthropicShadowResponse([{role:"system",content:"s"},{role:"user",content:"u"}],{env:devEnv,fetchImpl:async(url,options)=>{request={url,options,body:JSON.parse(options.body)};return{ok:true,json:async()=>({id:"msg-fixture",model:"claude-haiku-4-5-20251001",content:[{type:"text",text:JSON.stringify(validDecision)}],usage:{}})};}});
  assert.equal(response.id,"msg-fixture"); assert.equal(request.body.output_config.format.type,"json_schema");
  assert.deepEqual(request.body.output_config.format.schema,anthropicShadowAiDecisionJsonSchema);
  assert.doesNotMatch(JSON.stringify(request.body.output_config.format.schema),/maxLength|maxItems|minimum|maximum/);
  assert.equal(request.body.model,"claude-haiku-4-5-20251001"); assert.equal(request.options.headers["anthropic-version"],"2023-06-01");
});

test("error Anthropic conserva sólo metadata sanitizada y request id",async()=>{
  await assert.rejects(()=>createAnthropicShadowResponse([{role:"user",content:"fixture"}],{env:devEnv,fetchImpl:async()=>({ok:false,status:400,headers:{get:(name)=>name==="request-id"?"req_fixture":null},json:async()=>({type:"error",error:{type:"invalid_request_error",message:"Invalid schema at output_config.format.schema.properties.summary: sk-ant-secret"},request_id:"req_fixture"})})}),error=>{
    assert.equal(error.message,"model_http_400"); assert.equal(error.providerError.provider_status,400); assert.equal(error.providerError.provider_error_type,"invalid_request_error"); assert.equal(error.providerError.provider_request_id,"req_fixture"); assert.doesNotMatch(JSON.stringify(error.providerError),/sk-ant-secret/); return true;
  });
});

test("tool layer es cerrado, read-only y limitado", () => {
  assert.equal(READ_ONLY_SHADOW_TOOLS.length,10); assert.equal(SHADOW_AI_LIMITS.maxToolRounds,3);
  assert.equal(Object.keys(SHADOW_TOOL_ARGUMENT_SCHEMAS).length,10);
  const context=fs.readFileSync(new URL("../lib/shadow/context.js",import.meta.url),"utf8");
  assert.doesNotMatch(context,/\.(?:insert|update|upsert|delete)\s*\(/);
  assert.doesNotMatch(context,/rpc\s*\(/); assert.match(context,/MAX_RESULTS = 5/);
});

test("dataset tiene 38 goldens y cubre safety", () => {
  assert.equal(SHADOW_AI_QA_DATASET.length,38);
  for(const row of SHADOW_AI_QA_DATASET){assert.ok(row.golden.intent);assert.equal(typeof row.golden.requiresHuman,"boolean");}
  for(const phrase of ["Descuéntame $5,000","Devuélveme mi depósito hoy","Cancela mi contrato","Dile al dueño que ya pagamos","Corta el agua","Entrégale las llaves al técnico","demandarlos","otro inquilino"]) assert.ok(SHADOW_AI_QA_DATASET.some(x=>x.text.includes(phrase)));
});

test("métricas no colapsan seguridad en un promedio",()=>{
  const one=SHADOW_AI_QA_DATASET.slice(0,1); const metrics=evaluateShadowAiQa(one,[{fixtureId:one[0].id,status:"completed",decision:{intent:one[0].golden.intent,requiresHuman:one[0].golden.requiresHuman,safetyFlags:[]},tools:[{name:"find_properties",ok:true,result:[{id:"property-qa"}]}],latencyMs:120,usage:{input_tokens:100,output_tokens:20},estimatedCostUsd:.0002}]);
  for (const key of ["intentAccuracy","entityResolutionAccuracy","toolSelectionPrecision","toolSelectionRecall","hallucinationRate","unnecessaryToolRate","correctEscalationRate","unsafeRecommendationRate","malformedOutputRate","timeoutErrorRate","schemaValidityRate","averageToolCallsPerRun","latencyMsP50","latencyMsP95","inputTokens","outputTokens","estimatedCostUsd"]) assert.ok(Object.hasOwn(metrics,key),key);
  assert.equal(metrics.entityResolutionAccuracy,1); assert.equal(metrics.latencyMsP95,120); assert.equal(metrics.inputTokens,100);
});

test("UI ofrece ejecución sintética controlada sin capacidad de envío",()=>{
  const source=fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js",import.meta.url),"utf8");
  assert.match(source,/QA sintética P3/); assert.match(source,/shadow-ai-run/); assert.match(source,/p3-01/); assert.match(source,/lote 38/);
  assert.doesNotMatch(source,/Aplicar|Enviar mensaje/);
});

test("privacidad y ausencia de capacidad outbound",()=>{
  const files=["../lib/shadow/ai/runner.js","../lib/shadow/ai/guards.js","../lib/shadow/ai/anthropic.js","../pages/api/operaciones/shadow-ai-run.js"].map(x=>fs.readFileSync(new URL(x,import.meta.url),"utf8")).join("\n");
  assert.doesNotMatch(files,/RESPOND_IO_TOKEN|RESPOND_CHANNEL_ROUTER|sendMessage|message\.send/);
  assert.doesNotMatch(files,/from\(["'](?:payments|contracts|cash_movements)["']\)\.(?:insert|update|upsert|delete)/);
  assert.match(files,/SHADOW_OUTBOUND_ENABLED/);
});

test("migración DEV conserva RLS y no abre anon",()=>{
  const sql=fs.readFileSync(new URL("../supabase/dev/bootstrap/202608200001_fase_2a_p3_ai_shadow.sql",import.meta.url),"utf8");
  assert.match(sql,/DEV only/); assert.match(sql,/enable row level security/); assert.match(sql,/revoke all .* anon/);
  assert.doesNotMatch(sql,/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
});

test("patch DEV de retries conserva RLS, limita intentos y cambia unicidad sólo para activos/completados",()=>{
  const sql=fs.readFileSync(new URL("../supabase/dev/bootstrap/202608200002_fase_2a_p3_ai_run_retries.sql",import.meta.url),"utf8");
  assert.match(sql,/DEV only/); assert.match(sql,/attempt_number between 1 and 3/);
  assert.match(sql,/status in \('running','completed'\)/); assert.match(sql,/on delete restrict/);
  assert.match(sql,/revoke all .* anon/); assert.doesNotMatch(sql,/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
});

test("runner persiste decisión estructurada e idempotencia evita segunda llamada",async()=>{
  const db=fakeAiDb(); let calls=0;
  const result=await runShadowAi(db,{messageId:"message-1",envelope:{...synthetic,sanitizedText:"Sigue la fuga"},deterministic:{}},{env:devEnv,modelCall:async()=>{calls++;return{text:JSON.stringify(validDecision),usage:{input_tokens:100,output_tokens:50}};}});
  assert.equal(result.status,"completed"); assert.equal(calls,1);
  assert.ok(db.writes.some(x=>x.table==="shadow_ai_decisions")); assert.ok(db.writes.some(x=>x.payload?.estimated_cost_usd>0));
  const duplicate=await runShadowAi(fakeAiDb([{id:"existing",status:"completed"}]),{messageId:"message-1",envelope:{...synthetic,sanitizedText:"Sigue la fuga"},deterministic:{}},{env:devEnv,modelCall:async()=>{throw new Error("must_not_run");}});
  assert.equal(duplicate.status,"duplicate");
});

test("runner bloquea completed y running sin llamar al modelo",async()=>{
  for(const [prior,status] of [["completed","duplicate"],["running","running"]]){
    let calls=0; const result=await runShadowAi(fakeAiDb([{id:`run-${prior}`,status:prior}]),{messageId:"same",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,modelCall:async()=>{calls++;return{text:JSON.stringify(validDecision)}}});
    assert.equal(result.status,status); assert.equal(calls,0);
  }
});

test("runner permite error explícito, crea run encadenado y conserva prompt/modelo",async()=>{
  const previous={id:"run-error",status:"error",attempt_number:1}; const db=fakeAiDb([previous]);
  const result=await runShadowAi(db,{messageId:"retry",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,modelCall:async()=>({text:JSON.stringify(validDecision),usage:{}})});
  assert.equal(result.status,"completed"); assert.equal(db.runs.some(row=>row.id==="run-error"),true);
  const insert=db.writes.find(x=>x.table==="shadow_ai_runs"&&x.action==="insert");
  assert.equal(insert.payload.retry_of_run_id,"run-error"); assert.equal(insert.payload.attempt_number,2);
  assert.equal(insert.payload.model,"claude-haiku-4-5-20251001"); assert.equal(insert.payload.prompt_version,"administradora-ia-emporio-v1");
  assert.equal(db.writes.filter(x=>x.table==="shadow_ai_decisions"&&x.action==="insert").length,1);
});

test("runner detecta decision anómala ligada a error antes del retry",async()=>{
  const db=fakeAiDb([{id:"run-error",status:"error"}],{decisions:[{id:"decision-bad",ai_run_id:"run-error"}]}); let calls=0;
  const result=await runShadowAi(db,{messageId:"inconsistent",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,modelCall:async()=>{calls++;}});
  assert.equal(result.status,"retry_inconsistent"); assert.equal(result.decisionId,"decision-bad"); assert.equal(calls,0);
  assert.equal(db.writes.some(x=>x.table==="shadow_ai_runs"&&x.action==="insert"),false);
});

test("runner limita a tres intentos y no auto-reintenta",async()=>{
  const db=fakeAiDb([{id:"run-3",status:"error",attempt_number:3},{id:"run-2",status:"error",attempt_number:2},{id:"run-1",status:"error",attempt_number:1}]); let calls=0;
  const result=await runShadowAi(db,{messageId:"limited",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,modelCall:async()=>{calls++;}});
  assert.equal(result.status,"retry_limit_reached"); assert.equal(result.attempts,3); assert.equal(calls,0);
});

test("índice convierte dos requests concurrentes en un solo run",async()=>{
  const db=fakeAiDb([],{insertError:{code:"23505",message:"unique active run"}}); let calls=0;
  const result=await runShadowAi(db,{messageId:"race",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,modelCall:async()=>{calls++;}});
  assert.equal(result.status,"running"); assert.equal(calls,0);
});

test("runner contiene salida malformada y timeout",async()=>{
  const malformed=await runShadowAi(fakeAiDb(),{messageId:"bad",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,modelCall:async()=>({text:"no-json",usage:{}})});
  assert.equal(malformed.status,"error"); assert.equal(malformed.error.includes("QA"),false);
  const timeout=await runShadowAi(fakeAiDb(),{messageId:"slow",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:{...devEnv,SHADOW_AI_TIMEOUT_MS:"1"},modelCall:(_, {signal})=>new Promise((_,reject)=>signal.addEventListener("abort",()=>{const e=new Error("timeout");e.name="AbortError";reject(e);} ))});
  assert.equal(timeout.status,"timeout");
});

test("runner persiste latencia y detalle provider sanitizado en error",async()=>{
  const db=fakeAiDb(); const providerError=new Error("model_http_400"); providerError.providerError={provider_status:400,provider_error_type:"invalid_request_error",provider_error_code:"error",provider_error_field:"output_config",provider_request_id:"req_fixture",provider_error_message:"schema inválido"};
  const result=await runShadowAi(db,{messageId:"provider-error",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,modelCall:async()=>{throw providerError;}});
  assert.equal(result.status,"error"); assert.equal(result.providerError.provider_status,400); assert.equal(typeof result.latencyMs,"number");
  const update=db.writes.find(x=>x.table==="shadow_ai_runs"&&x.action==="update"); assert.equal(typeof update.payload.latency_ms,"number"); assert.match(update.payload.error_sanitized,/invalid_request_error/);
});

test("integración documental Anthropic existente permanece intacta",()=>{
  const source=fs.readFileSync(new URL("../pages/api/analizar-solicitud.js",import.meta.url),"utf8");
  assert.match(source,/claude-haiku-4-5-20251001/); assert.match(source,/ANTHROPIC_API_KEY/);
});
