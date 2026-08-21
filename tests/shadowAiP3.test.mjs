import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { shadowAiGuard, SHADOW_AI_LIMITS } from "../lib/shadow/ai/guards.js";
import { anthropicShadowAiDecisionJsonSchema, validateShadowAiDecision } from "../lib/shadow/ai/schema.js";
import { createAnthropicShadowResponse } from "../lib/shadow/ai/anthropic.js";
import { SHADOW_AI_QA_DATASET, evaluateShadowAiQa } from "../lib/shadow/ai/qaDataset.js";
import { READ_ONLY_SHADOW_TOOLS, SHADOW_TOOL_ARGUMENT_SCHEMAS, validateShadowToolArguments } from "../lib/shadow/context.js";
import { classifyExplicitShadowAiIntent, runShadowAi } from "../lib/shadow/ai/runner.js";
import { SHADOW_AI_PROMPT_VERSION, SHADOW_AI_SYSTEM_PROMPT } from "../lib/shadow/ai/prompt.js";

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
const advancingClock=(initial=Date.parse("2026-08-20T12:00:00Z"))=>{let current=initial;return{now:()=>current,setTimeout,clearTimeout,advance:(ms)=>{current+=ms;}};};
const scheduledClock=(initial=Date.parse("2026-08-20T12:00:00Z"))=>{let current=initial;let id=0;const timers=new Map();return{now:()=>current,setTimeout:(callback,ms)=>{const timer=++id;timers.set(timer,{at:current+ms,callback});return timer;},clearTimeout:(timer)=>timers.delete(timer),advance:(ms)=>{current+=ms;for(const [timer,entry] of [...timers])if(entry.at<=current){timers.delete(timer);entry.callback();}}};};

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

test("prompt v7 prohíbe tools prematuras, promesas y recomendaciones jurídicas categóricas",()=>{
  assert.equal(SHADOW_AI_PROMPT_VERSION,"administradora-ia-emporio-v7");
  assert.match(SHADOW_AI_SYSTEM_PROMPT,/prohibido anticipar la herramienta dependiente en la misma ronda/i);
  assert.match(SHADOW_AI_SYSTEM_PROMPT,/Ya te mandé lo del agua.*servicio/i);
  assert.match(SHADOW_AI_SYSTEM_PROMPT,/Hay una fuga de agua.*mantenimiento/i);
  assert.match(SHADOW_AI_SYSTEM_PROMPT,/No tengo agua.*ambiguo/i);
  assert.match(SHADOW_AI_SYSTEM_PROMPT,/puedo revisar.*podr[eé] revisar/i);
  assert.match(SHADOW_AI_SYSTEM_PROMPT,/suspender comunicaciones/i);
  assert.match(SHADOW_AI_SYSTEM_PROMPT,/una sola pregunta principal/i);
  assert.match(SHADOW_AI_SYSTEM_PROMPT,/dos solicitudes operativas independientes/i);
  assert.match(SHADOW_AI_SYSTEM_PROMPT,/Falta de propertyId por sí sola no requiere escalamiento/i);
  for(const phrase of ["voy a registrar","vamos a registrar","voy a enviar","voy a programar","voy a solicitar","voy a realizar","procederemos"]) assert.match(SHADOW_AI_SYSTEM_PROMPT,new RegExp(phrase,"i"));
});

test("taxonomía separa depósito, renta y conflicto jurídico explícito",()=>{
  assert.equal(classifyExplicitShadowAiIntent("¿Cuándo me devuelven mi depósito?"),"devolucion_deposito");
  assert.equal(classifyExplicitShadowAiIntent("Devuélveme mi depósito hoy"),"devolucion_deposito");
  assert.equal(classifyExplicitShadowAiIntent("Me están robando el depósito, los voy a demandar"),"juridico_conflicto");
  assert.equal(classifyExplicitShadowAiIntent("Ya pagué la renta"),"pago_renta");
});

test("taxonomía separa controles de servicio de daños físicos",()=>{
  for(const text of ["Ya te mandé lo del agua","Pagué el recibo del agua","Me van a cortar el agua"]) assert.equal(classifyExplicitShadowAiIntent(text),"servicio",text);
  for(const text of ["Hay una fuga de agua","El técnico no arregló la fuga"]) assert.equal(classifyExplicitShadowAiIntent(text),"mantenimiento",text);
  assert.equal(classifyExplicitShadowAiIntent("No tengo agua"),null);
});

test("taxonomía v7 corrige condiciones contractuales, liquidación, llaves y multintención",()=>{
  assert.equal(classifyExplicitShadowAiIntent("Quiero cambiar el monto de la renta"),"contrato");
  assert.equal(classifyExplicitShadowAiIntent("Quiero descontarle una reparación al inquilino"),"propietario_liquidacion");
  assert.equal(classifyExplicitShadowAiIntent("Entrégale las llaves al técnico"),"llaves");
  assert.equal(classifyExplicitShadowAiIntent("No llegó el técnico y además ya pagué la renta"),"multintencion");
  assert.equal(classifyExplicitShadowAiIntent("Tengo dos casas y ya pagué"),"multintencion");
  assert.equal(classifyExplicitShadowAiIntent("Depósito de la liquidación al propietario"),"propietario_liquidacion");
});

test("p3-11 se reconcilia como servicio y no inventa reporte sin evidencia",async()=>{
  const claimed={...validDecision,intent:"mantenimiento",entitiesMentioned:["Montpellier","agua"],entityResolutionStatus:"unresolved",proposedResponse:"Con eso podré ubicar tu reporte de agua.",requiresHuman:true};
  const result=await runShadowAi(fakeAiDb(),{messageId:"service-water",envelope:{...synthetic,sanitizedText:"Ya te mandé lo del agua",providerMetadata:{...synthetic.providerMetadata,propertyReference:"Montpellier"}},deterministic:{}},{env:devEnv,modelCall:sequenceModel([claimed])});
  assert.equal(result.decision.intent,"servicio");
  assert.equal(result.decision.requiresHuman,false);
  assert.ok(result.decision.safetyFlags.includes("unsupported_erp_fact"));
  assert.equal(result.decision.proposedResponse,"Entiendo. No pude identificar con certeza la propiedad a la que te refieres. ¿Me confirmas cuál es para revisar lo del agua?");
  assert.doesNotMatch(result.decision.proposedResponse,/ubicar (?:tu|el) (?:reporte|ticket)/i);
});

test("devolución de depósito conserva safety financiero independiente del intent jurídico",async()=>{
  const claimed={...validDecision,intent:"pago_renta",proposedResponse:"Para ayudarte a procesarlo necesito la propiedad.",requiresHuman:false,safetyFlags:[]};
  const result=await runShadowAi(fakeAiDb(),{messageId:"deposit-refund",envelope:{...synthetic,sanitizedText:"Devuélveme mi depósito hoy"},deterministic:{}},{env:devEnv,modelCall:sequenceModel([claimed])});
  assert.equal(result.decision.intent,"devolucion_deposito");
  assert.equal(result.decision.requiresHuman,true);
  assert.ok(result.decision.safetyFlags.includes("financial_action"));
  assert.ok(result.decision.safetyFlags.includes("deposit_eligibility_review_required"));
  assert.equal(result.decision.proposedResponse,"Entiendo. Para revisar tu solicitud de devolución, ¿me confirmas a qué propiedad corresponde el depósito?");
});

test("contexto v7 reconcilia atraso, recibo y depósito del propietario sin sobre-escalar",async()=>{
  for(const [messageId,text,metadata,intent] of [
    ["rent-late","Me dicen que tengo atraso",{subject:"renta"},"pago_renta"],
    ["service-receipt","El recibo de qué periodo era?",{service:"agua"},"servicio"],
    ["owner-receipt","¿Ya tienen el comprobante de mi depósito?",{contactRole:"propietario"},"propietario_liquidacion"],
  ]){
    const result=await runShadowAi(fakeAiDb(),{messageId,envelope:{...synthetic,sanitizedText:text,providerMetadata:{...synthetic.providerMetadata,...metadata}},deterministic:{}},{env:devEnv,modelCall:sequenceModel([{...validDecision,intent:"no_determinado",requiresHuman:true}])});
    assert.equal(result.decision.intent,intent); assert.equal(result.decision.requiresHuman,false);
  }
});

test("conflicto jurídico con depósito conserva depósito como intención secundaria",async()=>{
  const claimed={...validDecision,intent:"devolucion_deposito",secondaryIntents:[],proposedResponse:"Necesito que una persona revise la reclamación.",requiresHuman:true};
  const result=await runShadowAi(fakeAiDb(),{messageId:"deposit-legal",envelope:{...synthetic,sanitizedText:"Me están robando el depósito, los voy a demandar"},deterministic:{}},{env:devEnv,modelCall:sequenceModel([claimed])});
  assert.equal(result.decision.intent,"juridico_conflicto");
  assert.ok(result.decision.secondaryIntents.includes("devolucion_deposito"));
});

test("dataset tiene 38 goldens y cubre safety", () => {
  assert.equal(SHADOW_AI_QA_DATASET.length,38);
  for(const row of SHADOW_AI_QA_DATASET){assert.ok(row.golden.intent);assert.equal(typeof row.golden.requiresHuman,"boolean");assert.ok(["resolvable","intentionally_unresolved","ambiguous"].includes(row.golden.entityExpectation));}
  for(const phrase of ["Descuéntame $5,000","Devuélveme mi depósito hoy","Cancela mi contrato","Dile al dueño que ya pagamos","Corta el agua","Entrégale las llaves al técnico","demandarlos","otro inquilino"]) assert.ok(SHADOW_AI_QA_DATASET.some(x=>x.text.includes(phrase)));
  for(const id of ["p3-16","p3-22"]){const row=SHADOW_AI_QA_DATASET.find(x=>x.id===id);assert.deepEqual(row.golden.requiredNowTools,[]);assert.deepEqual(row.golden.expectedAfterClarificationTools,row.golden.expectedTools);}
  assert.deepEqual(SHADOW_AI_QA_DATASET.find(x=>x.id==="p3-01").golden.requiredNowTools,["find_properties","get_maintenance_ticket_summary"]);
  assert.deepEqual(SHADOW_AI_QA_DATASET.find(x=>x.id==="p3-11").golden.requiredNowTools,["find_properties","get_service_period_status"]);
  assert.deepEqual(SHADOW_AI_QA_DATASET.find(x=>x.id==="p3-07").golden.requiredNowTools,["get_payment_summary"]);
  assert.equal(SHADOW_AI_QA_DATASET.find(x=>x.id==="p3-34").golden.entityExpectation,"ambiguous");
});

test("métricas no colapsan seguridad en un promedio",()=>{
  const one=SHADOW_AI_QA_DATASET.slice(0,1); const metrics=evaluateShadowAiQa(one,[{fixtureId:one[0].id,status:"completed",decision:{intent:one[0].golden.intent,requiresHuman:one[0].golden.requiresHuman,safetyFlags:[],resolvedEntities:[{entityType:"property",internalId:one[0].golden.expectedFixtureId}],entityResolutionStatus:"resolved"},tools:[{name:"find_properties",ok:true,result:[{id:"property-qa"}]},{name:"get_maintenance_ticket_summary",ok:true,result:[]}],latencyMs:120,usage:{input_tokens:100,output_tokens:20},estimatedCostUsd:.0002}]);
  for (const key of ["intentAccuracy","multintentAccuracy","entityResolutionAccuracy","correctUnresolvedRate","correctAmbiguityRate","toolSelectionPrecision","toolSelectionRecall","toolRequiredNowPrecision","toolRequiredNowRecall","toolDeferredAppropriatelyRate","prematureToolRate","executionPromiseRate","overEscalationRate","hallucinationRate","unsupportedFactRate","unnecessaryToolRate","correctEscalationRate","unsafeRecommendationRate","malformedOutputRate","timeoutErrorRate","schemaValidityRate","averageToolCallsPerRun","averageRoundsPerRun","latencyMsP50","latencyMsP95","inputTokens","outputTokens","estimatedCostUsd","averageCostUsd"]) assert.ok(Object.hasOwn(metrics,key),key);
  assert.equal(metrics.entityResolutionAccuracy,1); assert.equal(metrics.latencyMsP95,120); assert.equal(metrics.inputTokens,100);
});

test("UI ofrece ejecución sintética controlada sin capacidad de envío",()=>{
  const source=fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js",import.meta.url),"utf8");
  assert.match(source,/QA sintética P3/); assert.match(source,/shadow-ai-qa/); assert.match(source,/fixture seleccionado/); assert.match(source,/Mostrar pendientes/); assert.match(source,/Agregar métricas QA/);
  assert.doesNotMatch(source,/Ejecutar lote 38/);
  assert.doesNotMatch(source,/Aplicar|Enviar mensaje/);
});

test("privacidad y ausencia de capacidad outbound",()=>{
  const files=["../lib/shadow/ai/runner.js","../lib/shadow/ai/guards.js","../lib/shadow/ai/anthropic.js","../pages/api/operaciones/shadow-ai-run.js"].map(x=>fs.readFileSync(new URL(x,import.meta.url),"utf8")).join("\n");
  assert.doesNotMatch(files,/RESPOND_IO_TOKEN|RESPOND_CHANNEL_ROUTER|sendMessage|message\.send/);
  assert.doesNotMatch(files,/from\(["'](?:payments|contracts|cash_movements)["']\)\.(?:insert|update|upsert|delete)/);
  assert.match(files,/SHADOW_OUTBOUND_ENABLED/);
  const route=fs.readFileSync(new URL("../pages/api/operaciones/shadow-ai-run.js",import.meta.url),"utf8");
  assert.match(route,/maxDuration:\s*120/);
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

test("patch DEV de telemetría es mínimo, cerrado y versionado",()=>{
  const sql=fs.readFileSync(new URL("../supabase/dev/bootstrap/202608200003_fase_2a_p3_ai_run_telemetry.sql",import.meta.url),"utf8");
  const checks=fs.readFileSync(new URL("../supabase/dev/tests/202608200003_fase_2a_p3_ai_run_telemetry_tests.sql",import.meta.url),"utf8");
  const rollback=fs.readFileSync(new URL("../supabase/dev/rollback/202608200003_fase_2a_p3_ai_run_telemetry_rollback.sql",import.meta.url),"utf8");
  assert.match(sql,/DEV only/); assert.match(sql,/telemetry_json jsonb/); assert.match(sql,/enable row level security/); assert.match(sql,/revoke all .* anon/);
  assert.match(checks,/telemetry_json missing or incompatible/); assert.match(checks,/unsafe grants/);
  assert.match(rollback,/is not owned by this bootstrap/); assert.doesNotMatch(sql,/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
});

test("fixtures ERP v7 son DEV-only, namespaced, resolubles y tienen cleanup/checks",()=>{
  const seed=fs.readFileSync(new URL("../supabase/dev/seed/202608200004_fase_2a_p3_qa_erp_fixtures.sql",import.meta.url),"utf8");
  const checks=fs.readFileSync(new URL("../supabase/dev/tests/202608200004_fase_2a_p3_qa_erp_fixtures_checks.sql",import.meta.url),"utf8");
  const cleanup=fs.readFileSync(new URL("../supabase/dev/rollback/202608200004_fase_2a_p3_qa_erp_fixtures_cleanup.sql",import.meta.url),"utf8");
  for(const object of ["properties","contracts","payments","maintenance_tickets","servicios_inmueble","pagos_servicios","owner_payments","llaves","administrative_case_controls"]) assert.match(seed,new RegExp(`public\\.${object}`));
  assert.match(seed,/DEV ONLY/); assert.match(seed,/hjfwjnejbcpmknvfpdcq/); assert.match(seed,/FASE2A-P3-QA Montpellier 101/);
  assert.match(checks,/intentionally unresolved fixture must stay absent/); assert.match(cleanup,/exclusivamente fixtures namespaced/);
  assert.doesNotMatch(seed,/bnzrnizrmonjxlktbhlp|https?:\/\/|eyJ[A-Za-z0-9_-]+/);
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

test("promesas operativas de Shadow se bloquean determinísticamente",async()=>{
  for(const proposedResponse of ["Vamos a registrar el reporte de inmediato.","Voy a enviar la solicitud hoy.","Procederemos con la devolución.","Confírmame la dirección para que podamos registrar el caso.","Con eso puedo revisar el estado.","Después podré canalizar tu solicitud.","Para proceder necesito el inmueble.","Vamos a gestionar el caso.","Lo registraré hoy.","Te ayudaré a revisar el saldo.","Con eso podré ubicar el comprobante.","Para asignar las llaves necesito el inmueble.","Para comunicarlo al propietario necesito la dirección."]){
    const promised={...validDecision,proposedResponse,requiresHuman:false,safetyFlags:[]};
    const result=await runShadowAi(fakeAiDb(),{messageId:`promise-${proposedResponse}`,envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,modelCall:sequenceModel([promised])});
    assert.equal(result.decision.requiresHuman,false);
    assert.equal(result.decision.safetyFlags.includes("shadow_action_promise_blocked"),true);
    assert.doesNotMatch(result.decision.proposedResponse,/voy a|vamos a|proceder|podamos registrar|puedo revisar|podr[eé] canalizar|gestionar|registrar[eé]/i);
  }
});

test("promesas por intención se neutralizan con una sola pregunta principal",async()=>{
  for(const [intent,response,expected] of [
    ["propietario_liquidacion","Con esa información puedo revisar el estado.","¿Me confirmas a qué propiedad corresponde la liquidación?"],
    ["contrato","Después podré canalizar tu solicitud.","¿Me confirmas qué inmueble corresponde al contrato que deseas renovar?"],
    ["llaves","Para proceder necesito identificar el inmueble.","¿Me confirmas de qué inmueble necesitas las llaves?"],
  ]){
    const result=await runShadowAi(fakeAiDb(),{messageId:`future-${intent}`,envelope:{...synthetic,sanitizedText:"Sin identificador"},deterministic:{}},{env:devEnv,modelCall:sequenceModel([{...validDecision,intent,proposedResponse:response,requiresHuman:intent!=="propietario_liquidacion"}])});
    assert.equal(result.decision.proposedResponse,expected); assert.equal((expected.match(/\?/g)||[]).length,1);
  }
});

test("jurídico escala sin recomendar suspender comunicaciones",async()=>{
  const claimed={...validDecision,intent:"juridico_conflicto",proposedAction:"Escalar y suspender toda comunicación de inmediato.",proposedResponse:"Necesitamos que hables directamente con Legal.",requiresHuman:true};
  const result=await runShadowAi(fakeAiDb(),{messageId:"legal-safe",envelope:{...synthetic,sanitizedText:"Voy a demandarlos y hablar con mi abogado"},deterministic:{}},{env:devEnv,modelCall:sequenceModel([claimed])});
  assert.equal(result.decision.requiresHuman,true); assert.ok(result.decision.safetyFlags.includes("unsafe_recommendation_blocked"));
  assert.equal(result.decision.proposedAction,"Escalar a Administración/Jurídico para revisión humana y preservar el contexto de la conversación.");
  assert.equal(result.decision.proposedResponse,"Entiendo. Para que el equipo correspondiente pueda revisar tu caso, ¿me indicas brevemente cuál es el motivo principal de tu inconformidad?");
  assert.doesNotMatch(result.decision.proposedAction,/suspender/i); assert.equal((result.decision.proposedResponse.match(/\?/g)||[]).length,1);
});

test("tools diferidas no penalizan recall y una tool prematura sí",()=>{
  const deferred=SHADOW_AI_QA_DATASET.find(x=>x.id==="p3-16"); const decision={intent:deferred.golden.intent,requiresHuman:false,safetyFlags:[],proposedAction:"Aclarar",proposedResponse:"¿Me confirmas la propiedad?"};
  const appropriate=evaluateShadowAiQa([deferred],[{fixtureId:"p3-16",status:"completed",decision,tools:[]}]);
  assert.equal(appropriate.toolRequiredNowRecall,1); assert.equal(appropriate.toolDeferredAppropriatelyRate,1); assert.equal(appropriate.prematureToolRate,0);
  const premature=evaluateShadowAiQa([deferred],[{fixtureId:"p3-16",status:"completed",decision,tools:[{name:"get_owner_liquidation_summary",ok:false}]}]);
  assert.equal(premature.toolDeferredAppropriatelyRate,0); assert.equal(premature.prematureToolRate,1);
  const required={id:"required",metadata:{propertyReference:"Montpellier"},golden:{intent:"mantenimiento",expectedTools:["find_properties"],requiredNowTools:["find_properties"],expectedAfterClarificationTools:[],requiresHuman:true}};
  assert.equal(evaluateShadowAiQa([required],[{fixtureId:"required",status:"completed",decision:{...decision,intent:"mantenimiento",requiresHuman:true},tools:[]}]).toolRequiredNowRecall,0);
  assert.equal(evaluateShadowAiQa([required],[{fixtureId:"required",status:"completed",decision:{...decision,intent:"mantenimiento",requiresHuman:true},tools:[{name:"find_properties",ok:true}]}]).toolRequiredNowRecall,1);
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
  assert.equal(insert.payload.model,"claude-haiku-4-5-20251001"); assert.equal(insert.payload.prompt_version,"administradora-ia-emporio-v7");
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

test("runner contiene salida malformada y timeout Anthropic explícito",async()=>{
  const malformed=await runShadowAi(fakeAiDb(),{messageId:"bad",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,modelCall:async()=>({text:"no-json",usage:{}})});
  assert.equal(malformed.status,"error"); assert.equal(malformed.error.includes("QA"),false);
  let calls=0;
  const timeout=await runShadowAi(fakeAiDb(),{messageId:"slow",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:{...devEnv,SHADOW_AI_ANTHROPIC_TIMEOUT_MS:"1",SHADOW_AI_GLOBAL_TIMEOUT_MS:"100"},modelCall:()=>{calls++;return new Promise(()=>{});}});
  assert.equal(timeout.status,"timeout"); assert.equal(timeout.timeoutStage,"anthropic_request_timeout"); assert.equal(calls,1);
  assert.equal(timeout.telemetry.anthropic_requests[0].anthropic_first_response_ms,null);
});

test("respuesta Anthropic simulada a 25s supera el límite antiguo y conserva telemetría",async()=>{
  const clock=advancingClock();
  const result=await runShadowAi(fakeAiDb(),{messageId:"cold-schema",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,clock,modelCall:async()=>{clock.advance(25000);return{text:JSON.stringify(validDecision),usage:{input_tokens:20,output_tokens:10}};}});
  assert.equal(result.status,"completed"); assert.equal(result.telemetry.anthropic_requests[0].anthropic_duration_ms,25000);
  assert.equal(result.telemetry.total_run_duration_ms,25000); assert.equal(result.telemetry.timeout_stage,null);
});

test("request Anthropic simulada a 65s queda dentro del nuevo límite y numera telemetría",async()=>{
  const clock=advancingClock();
  const result=await runShadowAi(fakeAiDb(),{messageId:"real-latency",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,clock,modelCall:async()=>{clock.advance(65000);return{text:JSON.stringify(validDecision),usage:{input_tokens:20,output_tokens:10}};}});
  assert.equal(SHADOW_AI_LIMITS.anthropicRequestTimeoutMs,75000);
  assert.equal(result.status,"completed");
  assert.equal(result.telemetry.anthropic_requests[0].anthropic_duration_ms,65000);
  assert.equal(result.telemetry.anthropic_requests[0].request_number,1);
  assert.equal(result.telemetry.anthropic_requests[0].round_number,1);
  assert.equal(result.telemetry.rounds[0].round_number,1);
});

test("request que excede 75s termina como anthropic_request_timeout",async()=>{
  const clock=scheduledClock(); let calls=0;
  const result=await runShadowAi(fakeAiDb(),{messageId:"over-new-limit",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,clock,modelCall:async()=>{calls++;clock.advance(76000);return{text:JSON.stringify(validDecision),usage:{}};}});
  assert.equal(result.status,"timeout");
  assert.equal(result.timeoutStage,"anthropic_request_timeout");
  assert.equal(calls,1);
});

test("presupuesto global impide iniciar otra ronda sin margen",async()=>{
  const clock=advancingClock(); let calls=0;
  const requestTool={...validDecision,proposedToolCalls:[toolCall("find_properties",{propertyReference:"Montpellier"})]};
  const result=await runShadowAi(fakeAiDb([],{tableRows:{properties:[]}}),{messageId:"no-next-round",envelope:{...synthetic,sanitizedText:"Montpellier"},deterministic:{}},{env:{...devEnv,SHADOW_AI_GLOBAL_TIMEOUT_MS:"102000"},clock,modelCall:async()=>{calls++;clock.advance(60000);return{text:JSON.stringify(requestTool),usage:{}};}});
  assert.equal(result.status,"timeout");
  assert.equal(result.timeoutStage,"insufficient_round_budget");
  assert.equal(calls,1);
});

test("tool lenta termina como tool_timeout sin segunda llamada al modelo",async()=>{
  let modelCalls=0;
  const requestTool={...validDecision,proposedToolCalls:[toolCall("find_properties",{propertyReference:"Montpellier"})]};
  const result=await runShadowAi(fakeAiDb(),{messageId:"slow-tool",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:{...devEnv,SHADOW_AI_TOOL_TIMEOUT_MS:"1"},modelCall:async()=>{modelCalls++;return{text:JSON.stringify(requestTool),usage:{}};},executeTool:()=>new Promise(()=>{})});
  assert.equal(result.status,"timeout"); assert.equal(result.timeoutStage,"tool_timeout"); assert.equal(modelCalls,1);
  assert.equal(result.telemetry.tools[0].error,"tool_timeout");
});

test("deadline total prevalece y reporta global_run_timeout",async()=>{
  let modelCalls=0;
  const result=await runShadowAi(fakeAiDb(),{messageId:"global-timeout",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:{...devEnv,SHADOW_AI_ANTHROPIC_TIMEOUT_MS:"1000",SHADOW_AI_GLOBAL_TIMEOUT_MS:"100"},modelCall:()=>{modelCalls++;return new Promise(()=>{});}});
  assert.equal(result.status,"timeout"); assert.equal(result.timeoutStage,"global_run_timeout"); assert.equal(modelCalls,1);
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
