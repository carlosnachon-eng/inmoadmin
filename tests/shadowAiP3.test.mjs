import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { shadowAiGuard, SHADOW_AI_LIMITS } from "../lib/shadow/ai/guards.js";
import { anthropicShadowAiDecisionJsonSchema, validateShadowAiDecision } from "../lib/shadow/ai/schema.js";
import { createAnthropicShadowResponse } from "../lib/shadow/ai/anthropic.js";
import { SHADOW_AI_QA_DATASET, evaluateShadowAiQa } from "../lib/shadow/ai/qaDataset.js";
import { READ_ONLY_SHADOW_TOOLS, SHADOW_TOOL_ARGUMENT_SCHEMAS, validateShadowToolArguments } from "../lib/shadow/context.js";
import { runShadowAi } from "../lib/shadow/ai/runner.js";

const devEnv = { SHADOW_AI_ENABLED:"true", SHADOW_AI_ALLOW_REAL_MESSAGES:"false", SHADOW_OUTBOUND_ENABLED:"false", SUPABASE_ENVIRONMENT:"dev", NEXT_PUBLIC_SUPABASE_URL:"https://hjfwjnejbcpmknvfpdcq.supabase.co", ANTHROPIC_API_KEY:"fixture" };
const synthetic = { provider:"synthetic", providerMetadata:{syntheticScenario:"p3-01"} };
const validDecision={intent:"mantenimiento",secondaryIntents:[],urgency:"normal",summary:"Fuga",entitiesMentioned:[],resolvedEntities:[],entityResolutionStatus:"not_applicable",informationNeeded:[],proposedToolCalls:[],contextAssessment:"Sin contexto",proposedAction:"Escalar",proposedResponse:"Lo revisará el equipo.",confidence:.8,requiresHuman:true,escalationReason:"Revisión",safetyFlags:[]};
function fakeAiDb(initialRuns=[], options={}){
  const writes=[]; const reads=[]; const runs=(Array.isArray(initialRuns) ? initialRuns : initialRuns ? [initialRuns] : []).map((row,index)=>({attempt_number:index+1,created_at:`2026-08-20T10:0${index}:00Z`,...row}));
  const decisions=[...(options.decisions || [])]; let nextRun=runs.length+1;
  return {writes,reads,runs,decisions,from(table){let action="select",payload,filter={};reads.push(table);
    const q={select(){return q;},eq(column,value){if(column!=="idempotency_key")filter[column]=value;return q;},ilike(){return q;},in(){return q;},order(){return q;},limit(){return q;},
      maybeSingle:async()=>{const rows=table==="shadow_ai_decisions" ? decisions : runs;const found=rows.find(row=>Object.entries(filter).every(([key,value])=>row[key]===value));return{data:found||null,error:null};},
      insert(value){action="insert";payload=value;writes.push({table,action,payload});return q;},
      update(value){action="update";payload=value;writes.push({table,action,payload});return q;},
      single:async()=>{if(table==="shadow_ai_runs"&&action==="insert"){if(options.insertError)return{data:null,error:options.insertError};const row={id:`run-${nextRun++}`,created_at:new Date().toISOString(),...payload};runs.unshift(row);return{data:{id:row.id},error:null};}return{data:{id:"fixture"},error:null};},
      then(resolve){if(action!=="select")return resolve({data:null,error:null});const source=table==="shadow_ai_runs"?runs:table==="shadow_ai_decisions"?decisions:(options.tableRows?.[table]||[]);const rows=source.filter(row=>Object.entries(filter).every(([key,value])=>row[key]===value));return resolve({data:rows,error:null});}}; return q;
  }};
}
const toolCall=(tool,arguments_,reason="Contexto necesario")=>({tool,arguments:arguments_,reason});
const sequenceModel=(decisions)=>{let index=0;return async()=>({text:JSON.stringify(decisions[Math.min(index++,decisions.length-1)]),usage:{input_tokens:10,output_tokens:5}});};

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

test("cada tool tiene schema nominal estricto y rechaza argumentos faltantes o extra",()=>{
  assert.deepEqual(Object.keys(SHADOW_TOOL_ARGUMENT_SCHEMAS),READ_ONLY_SHADOW_TOOLS);
  assert.deepEqual(validateShadowToolArguments("find_properties",{propertyReference:"Montpellier"}),{propertyReference:"Montpellier"});
  assert.deepEqual(validateShadowToolArguments("get_maintenance_ticket_summary",{propertyId:"f1000000-0000-4000-8100-000000000001"}),{propertyId:"f1000000-0000-4000-8100-000000000001"});
  assert.throws(()=>validateShadowToolArguments("find_properties",{}),/invalid_tool_arguments/);
  assert.throws(()=>validateShadowToolArguments("find_properties",{query:"Montpellier"}),/invalid_tool_arguments/);
  assert.throws(()=>validateShadowToolArguments("get_maintenance_ticket_summary",{propertyId:"not-an-id"}),/invalid_tool_arguments/);
});

test("dataset tiene 38 goldens y cubre safety", () => {
  assert.equal(SHADOW_AI_QA_DATASET.length,38);
  for(const row of SHADOW_AI_QA_DATASET){assert.ok(row.golden.intent);assert.equal(typeof row.golden.requiresHuman,"boolean");}
  for(const phrase of ["Descuéntame $5,000","Devuélveme mi depósito hoy","Cancela mi contrato","Dile al dueño que ya pagamos","Corta el agua","Entrégale las llaves al técnico","demandarlos","otro inquilino"]) assert.ok(SHADOW_AI_QA_DATASET.some(x=>x.text.includes(phrase)));
});

test("métricas no colapsan seguridad en un promedio",()=>{
  const one=SHADOW_AI_QA_DATASET.slice(0,1); const metrics=evaluateShadowAiQa(one,[{fixtureId:one[0].id,status:"completed",decision:{intent:one[0].golden.intent,requiresHuman:one[0].golden.requiresHuman,safetyFlags:[]},tools:[{name:"find_properties",ok:true,result:[{id:"property-qa"}]}],latencyMs:120,usage:{input_tokens:100,output_tokens:20},estimatedCostUsd:.0002}]);
  for (const key of ["intentAccuracy","entityResolutionAccuracy","toolSelectionPrecision","toolSelectionRecall","hallucinationRate","unsupportedFactRate","unnecessaryToolRate","correctEscalationRate","unsafeRecommendationRate","malformedOutputRate","timeoutErrorRate","schemaValidityRate","averageToolCallsPerRun","latencyMsP50","latencyMsP95","inputTokens","outputTokens","estimatedCostUsd"]) assert.ok(Object.hasOwn(metrics,key),key);
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

test("A/C: loop ejecuta argumentos válidos y espera IDs de la ronda anterior",async()=>{
  const propertyId="f1000000-0000-4000-8100-000000000001";
  const db=fakeAiDb([], {tableRows:{properties:[{id:propertyId,name:"Montpellier"}],maintenance_tickets:[{id:"f1000000-0000-4000-8200-000000000001",property_id:propertyId,property_name:"Montpellier",status:"abierto",priority:"alta",created_at:"2026-08-20"}]}});
  const round1={...validDecision,entitiesMentioned:["Montpellier"],entityResolutionStatus:"unresolved",proposedToolCalls:[toolCall("find_properties",{propertyReference:"Montpellier"}),toolCall("get_maintenance_ticket_summary",{propertyId})]};
  const round2={...validDecision,entitiesMentioned:["Montpellier"],proposedToolCalls:[toolCall("get_maintenance_ticket_summary",{propertyId})]};
  const round3={...validDecision,entitiesMentioned:["Montpellier"],resolvedEntities:[{entityType:"property",internalId:propertyId,label:"Montpellier"}],entityResolutionStatus:"resolved",proposedToolCalls:[],contextAssessment:"Propiedad y mantenimiento confirmados"};
  const result=await runShadowAi(db,{messageId:"tool-loop",envelope:{...synthetic,sanitizedText:"Sigue la fuga",providerMetadata:{...synthetic.providerMetadata,propertyReference:"Montpellier"}},deterministic:{}},{env:devEnv,modelCall:sequenceModel([round1,round2,round3])});
  assert.equal(result.status,"completed"); assert.equal(result.rounds,3);
  assert.equal(result.tools.filter(x=>x.ok).map(x=>x.name).join(","),"find_properties,get_maintenance_ticket_summary");
  assert.equal(result.tools.some(x=>x.error==="missing_dependency:propertyId"),true);
  assert.equal(result.decision.entityResolutionStatus,"resolved"); assert.equal(result.decision.resolvedEntities.some(x=>x.internalId===propertyId),true);
});

test("B: tool sin required no ejecuta y Claude puede corregir en ronda siguiente",async()=>{
  const db=fakeAiDb(); const invalid={...validDecision,proposedToolCalls:[toolCall("find_properties",{})]};
  const result=await runShadowAi(db,{messageId:"invalid-args",envelope:{...synthetic,sanitizedText:"Montpellier"},deterministic:{}},{env:devEnv,modelCall:sequenceModel([invalid,validDecision])});
  assert.equal(result.status,"completed"); assert.equal(result.rounds,2); assert.equal(result.tools[0].ok,false); assert.equal(result.tools[0].error,"invalid_tool_arguments");
  assert.equal(db.reads.filter(x=>x==="properties").length,0);
});

test("D/E/F: entidades mencionadas sólo se resuelven con evidencia y distinguen ambiguous/unresolved",async()=>{
  const propertyCall={...validDecision,entitiesMentioned:["Montpellier"],entityResolutionStatus:"unresolved",proposedToolCalls:[toolCall("find_properties",{propertyReference:"Montpellier"})]};
  const final={...validDecision,entitiesMentioned:["Montpellier"],proposedToolCalls:[]};
  const multiple=fakeAiDb([],{tableRows:{properties:[{id:"f1000000-0000-4000-8100-000000000001",name:"Montpellier 1"},{id:"f1000000-0000-4000-8100-000000000002",name:"Montpellier 2"}]}});
  const dependent={...validDecision,entitiesMentioned:["Montpellier"],proposedToolCalls:[toolCall("get_maintenance_ticket_summary",{propertyId:"f1000000-0000-4000-8100-000000000001"})]};
  const ambiguous=await runShadowAi(multiple,{messageId:"ambiguous",envelope:{...synthetic,sanitizedText:"Montpellier"},deterministic:{}},{env:devEnv,modelCall:sequenceModel([propertyCall,dependent,final])});
  assert.equal(ambiguous.decision.entityResolutionStatus,"ambiguous"); assert.equal(ambiguous.decision.resolvedEntities.length,2);
  assert.equal(ambiguous.tools.some((tool)=>tool.error==="ambiguous_dependency:propertyId"),true);
  assert.equal(multiple.reads.filter((table)=>table==="maintenance_tickets").length,0);
  const absent=await runShadowAi(fakeAiDb([],{tableRows:{properties:[]}}),{messageId:"absent",envelope:{...synthetic,sanitizedText:"Montpellier"},deterministic:{}},{env:devEnv,modelCall:sequenceModel([propertyCall,final])});
  assert.equal(absent.decision.entityResolutionStatus,"unresolved"); assert.deepEqual(absent.decision.resolvedEntities,[]); assert.deepEqual(absent.decision.entitiesMentioned,["Montpellier"]);
});

test("G/J: afirmación ERP sin evidencia cuenta como unsupported/hallucination y se neutraliza",async()=>{
  const unsupported={...validDecision,entitiesMentioned:["Montpellier"],resolvedEntities:[{entityType:"property",internalId:"f1000000-0000-4000-8100-000000000001",label:"Montpellier"}],entityResolutionStatus:"resolved",proposedResponse:"Ya revisé y veo que tenemos registrado el caso. ¿Cuándo empezó? ¿Dónde está la fuga?"};
  const result=await runShadowAi(fakeAiDb(),{messageId:"unsupported",envelope:{...synthetic,sanitizedText:"Montpellier"},deterministic:{}},{env:devEnv,modelCall:sequenceModel([unsupported])});
  assert.equal(result.decision.safetyFlags.includes("unsupported_erp_fact"),true); assert.equal(result.decision.entityResolutionStatus,"unresolved"); assert.deepEqual(result.decision.resolvedEntities,[]);
  assert.doesNotMatch(result.decision.proposedResponse,/Ya revisé|veo que|tenemos registrado/i); assert.equal((result.decision.proposedResponse.match(/\?/g)||[]).length,1);
  const metrics=evaluateShadowAiQa([{id:"p3-x",metadata:{propertyReference:"Montpellier"},golden:{intent:"mantenimiento",expectedTools:[],requiresHuman:true}}],[{fixtureId:"p3-x",status:"completed",decision:result.decision,tools:[]}]);
  assert.equal(metrics.unsupportedFactRate,1); assert.equal(metrics.hallucinationRate,1);
});

test("H: loop nunca supera tres rondas ni ejecuta tools nuevas en la última",async()=>{
  const invalid={...validDecision,proposedToolCalls:[toolCall("find_properties",{})]}; let calls=0;
  const result=await runShadowAi(fakeAiDb(),{messageId:"three-rounds",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,modelCall:async()=>{calls++;return{text:JSON.stringify(invalid),usage:{}};}});
  assert.equal(calls,3); assert.equal(result.rounds,3); assert.equal(result.tools.length,3); assert.equal(result.tools.every(x=>!x.ok),true);
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
  assert.equal(insert.payload.model,"claude-haiku-4-5-20251001"); assert.equal(insert.payload.prompt_version,"administradora-ia-emporio-v2");
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
