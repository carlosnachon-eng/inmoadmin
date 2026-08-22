import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { shadowAiGuard, SHADOW_AI_LIMITS } from "../lib/shadow/ai/guards.js";
import { anthropicShadowAiDecisionJsonSchema, validateShadowAiDecision } from "../lib/shadow/ai/schema.js";
import { createAnthropicShadowResponse } from "../lib/shadow/ai/anthropic.js";
import { SHADOW_AI_QA_DATASET, SHADOW_AI_QA_REGRESSION_FIXTURES, evaluateShadowAiQa } from "../lib/shadow/ai/qaDataset.js";
import { READ_ONLY_SHADOW_TOOLS, SHADOW_TOOL_ARGUMENT_SCHEMAS, validateShadowToolArguments } from "../lib/shadow/context.js";
import { classifyExplicitShadowAiIntent, finalizeShadowAiDecision, runShadowAi } from "../lib/shadow/ai/runner.js";
import { SHADOW_AI_PROMPT_VERSION, SHADOW_AI_SYSTEM_PROMPT } from "../lib/shadow/ai/prompt.js";
import { buildEvidenceLedger, groundAndRenderDecision } from "../lib/shadow/ai/grounding.js";
import { combinePolicyAndModelTools, deriveRequiredTools } from "../lib/shadow/ai/toolPolicy.js";
import { buildResolvedOperationalContext } from "../lib/shadow/ai/operationalContext.js";
import { startShadowAiStateMachine } from "../lib/shadow/ai/stateMachine.js";

const devEnv = { SHADOW_AI_ENABLED:"true", SHADOW_AI_ALLOW_REAL_MESSAGES:"false", SHADOW_OUTBOUND_ENABLED:"false", SUPABASE_ENVIRONMENT:"dev", NEXT_PUBLIC_SUPABASE_URL:"https://hjfwjnejbcpmknvfpdcq.supabase.co", ANTHROPIC_API_KEY:"fixture" };
const synthetic = { provider:"synthetic", providerMetadata:{syntheticScenario:"p3-01"} };
const validDecision={intent:"mantenimiento",secondaryIntents:[],urgency:"normal",summary:"Fuga",entitiesMentioned:[],resolvedEntities:[],entityResolutionStatus:"not_applicable",informationNeeded:[],proposedToolCalls:[],contextAssessment:"Sin contexto",proposedAction:"Escalar",factualClaims:[],conversationalResponseParts:{acknowledgement:"Entiendo.",verifiedFactReferences:[],clarificationQuestion:null,escalationMessage:"Esto requiere revisión del equipo."},executionCommitment:"none",confidence:.8,requiresHuman:true,escalationReason:"Revisión",safetyFlags:[]};
function fakeAiDb(initialRuns=[], options={}){
  const writes=[]; const reads=[]; const runs=(Array.isArray(initialRuns) ? initialRuns : initialRuns ? [initialRuns] : []).map((row,index)=>({attempt_number:index+1,created_at:`2026-08-20T10:0${index}:00Z`,...row}));
  const decisions=[...(options.decisions || [])]; let nextRun=runs.length+1;
  return {writes,reads,runs,decisions,from(table){let action="select",payload,filter={};reads.push(table);
    const q={select(){return q;},eq(column,value){if(column!=="idempotency_key"||options.filterIdempotencyKey)filter[column]=value;return q;},ilike(){return q;},in(){return q;},order(){return q;},limit(){return q;},
      maybeSingle:async()=>{const rows=table==="shadow_ai_decisions" ? decisions : table==="shadow_ai_runs" ? runs : (options.tableRows?.[table]||[]);const found=rows.find(row=>Object.entries(filter).every(([key,value])=>row[key]===value));return{data:found||null,error:null};},
      insert(value){action="insert";payload=value;writes.push({table,action,payload});return q;},
      update(value){action="update";payload=value;writes.push({table,action,payload});return q;},
      single:async()=>{if(table==="shadow_ai_runs"&&action==="insert"){if(options.insertError)return{data:null,error:options.insertError};const row={id:`run-${nextRun++}`,created_at:new Date().toISOString(),...payload};runs.unshift(row);return{data:{id:row.id},error:null};}return{data:{id:"fixture"},error:null};},
      then(resolve){if(action!=="select")return resolve({data:null,error:null});const source=table==="shadow_ai_runs"?runs:table==="shadow_ai_decisions"?decisions:(options.tableRows?.[table]||[]);const rows=source.filter(row=>Object.entries(filter).every(([key,value])=>row[key]===value));return resolve({data:rows,error:null});}}; return q;
  }};
}
const toolCall=(tool,arguments_,reason="Contexto necesario")=>({tool,arguments:arguments_,reason});
const toV8=(decision)=>{const {proposedResponse,...rest}=decision;return proposedResponse===undefined?decision:{...rest,conversationalResponseParts:{acknowledgement:proposedResponse,verifiedFactReferences:[],clarificationQuestion:null,escalationMessage:null}};};
const sequenceModel=(decisions)=>{let index=0;return async()=>({text:JSON.stringify(toV8(decisions[Math.min(index++,decisions.length-1)])),usage:{input_tokens:10,output_tokens:5}});};
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

test("grounding determinístico bloquea contradicciones críticas y conserva evidencia canónica",()=>{
  const paymentId="f2a30000-0000-4000-8300-000000000001";
  const tools=[{name:"get_payment_summary",ok:true,result:[{entityType:"payment",internalId:paymentId,status:"pagado",period:"2026-08",amount:12500}]}];
  const evidenceId=`payment:${paymentId}`;
  assert.deepEqual(buildEvidenceLedger(tools)[0].facts,{status:"pagado",period:"2026-08",amount:12500});
  for(const [factType,value] of [["payment.status","pendiente"],["payment.amount",12000]]){
    const grounded=groundAndRenderDecision({...validDecision,factualClaims:[{factType,value,evidenceIds:[evidenceId]}]},tools);
    assert.equal(grounded.responseBlocked,true); assert.equal(grounded.groundingStatus,"blocked");
    assert.match(grounded.groundingReason,/critical_fact_contradiction/); assert.ok(grounded.safetyFlags.includes("hallucination"));
    assert.match(grounded.proposedResponse,/Respuesta bloqueada/);
  }
});

test("regresión p3-07: ERP pagado nunca puede renderizarse como pendiente",()=>{
  const id="f2a30000-0000-4000-8300-000000000001";
  const result=groundAndRenderDecision({...validDecision,factualClaims:[{factType:"payment.status",value:"pendiente",evidenceIds:[`payment:${id}`]}]},[{name:"get_payment_summary",ok:true,result:[{entityType:"payment",internalId:id,status:"pagado",period:"2026-08",amount:12500}]}]);
  assert.equal(result.responseBlocked,true); assert.doesNotMatch(result.proposedResponse,/pendiente/i); assert.ok(result.safetyFlags.includes("critical_fact_contradiction"));
});

test("renderer canonicaliza texto crítico consistente y usa exclusivamente el ledger",()=>{
  const id="f2a30000-0000-4000-8300-000000000001"; const evidenceId=`payment:${id}`;
  const tools=[{name:"get_payment_summary",ok:true,result:[{entityType:"payment",internalId:id,status:"pagado",period:"2026-08-05",amount:12500}]}];
  const decision={...validDecision,factualClaims:[{factType:"payment.status",value:"pagado",evidenceIds:[evidenceId]},{factType:"payment.period",value:"2026-08-05",evidenceIds:[evidenceId]}],conversationalResponseParts:{acknowledgement:"Tu renta más reciente está completamente pagada.",verifiedFactReferences:[evidenceId],clarificationQuestion:null,escalationMessage:null}};
  const result=groundAndRenderDecision(decision,tools);
  assert.equal(result.responseBlocked,false); assert.equal(result.groundingStatus,"grounded");
  assert.equal(result.canonicalizedCriticalFact,true); assert.equal(result.freeTextCriticalFactAction,"canonicalized");
  assert.equal(result.conversationalResponseParts.acknowledgement,"Entiendo.");
  assert.doesNotMatch(result.proposedResponse,/completamente pagada/i); assert.match(result.proposedResponse,/registrado como pagado/i); assert.match(result.proposedResponse,/2026-08-05/);
  assert.equal(result.safetyFlags.includes("unsupported_erp_fact"),false);
});

test("texto crítico contradictorio continúa bloqueado aunque el claim sea correcto",()=>{
  const id="f2a30000-0000-4000-8300-000000000001"; const evidenceId=`payment:${id}`;
  const tools=[{name:"get_payment_summary",ok:true,result:[{entityType:"payment",internalId:id,status:"pagado"}]}];
  const result=groundAndRenderDecision({...validDecision,factualClaims:[{factType:"payment.status",value:"pagado",evidenceIds:[evidenceId]}],conversationalResponseParts:{acknowledgement:"Tienes una renta pendiente.",verifiedFactReferences:[evidenceId],clarificationQuestion:null,escalationMessage:null}},tools);
  assert.equal(result.responseBlocked,true); assert.match(result.groundingReason,/critical_fact_text_contradiction/); assert.ok(result.safetyFlags.includes("hallucination"));
});

test("regresión p3-12: recibo no disponible es compatible con hasReceipt=false",()=>{
  const id="f2a30000-0000-4000-8500-000000000002";
  const evidenceId=`service:${id}:control:f2a30000-0000-4000-8600-000000000002`;
  const tools=[{name:"get_service_period_status",ok:true,result:[{entityType:"service",internalId:id,evidenceId,status:"pendiente",period:"2026-08",amount:920,hasReceipt:false}]}];
  const result=groundAndRenderDecision({...validDecision,intent:"servicio",factualClaims:[
    {factType:"service.status",value:"pendiente",evidenceIds:[evidenceId]},
    {factType:"service.period",value:"2026-08",evidenceIds:[evidenceId]},
    {factType:"service.amount",value:920,evidenceIds:[evidenceId]},
    {factType:"service.hasReceipt",value:false,evidenceIds:[evidenceId]},
  ],conversationalResponseParts:{acknowledgement:"Revisé el estado de tu servicio de CFE.",verifiedFactReferences:[evidenceId],clarificationQuestion:null,escalationMessage:"El servicio del periodo agosto 2026 está pendiente de pago (monto: $920) y aún no tiene recibo disponible."}},tools);
  assert.equal(result.responseBlocked,false); assert.equal(result.groundingStatus,"grounded");
  assert.doesNotMatch(result.groundingReason||"",/critical_fact_text_contradiction/);
  assert.match(result.proposedResponse,/pendiente/); assert.match(result.proposedResponse,/no tiene comprobante/);
});

test("p3-12 permite escalamiento descriptivo grounded sin convertirlo en compromiso",()=>{
  const id="f2a30000-0000-4000-8500-000000000002";
  const evidenceId=`service:${id}:control:f2a30000-0000-4000-8600-000000000002`;
  const tools=[{name:"get_service_period_status",ok:true,result:[{entityType:"service",internalId:id,evidenceId,status:"pendiente",period:"2026-08",amount:920,hasReceipt:false}]}];
  const result=finalizeShadowAiDecision({...validDecision,intent:"servicio",executionCommitment:"implied",factualClaims:[
    {factType:"service.status",value:"pendiente",evidenceIds:[evidenceId]},
    {factType:"service.hasReceipt",value:false,evidenceIds:[evidenceId]},
  ],conversationalResponseParts:{acknowledgement:"Esto requiere revisión del equipo de Administración.",verifiedFactReferences:[evidenceId],clarificationQuestion:null,escalationMessage:null}}, {sanitizedText:"¿Qué pasó con el recibo de CFE?",providerMetadata:{service:"cfe"}}, tools);
  assert.equal(result.executionCommitment,"none");
  assert.equal(result.responseBlocked,false);
  assert.equal(result.groundingStatus,"grounded");
});

test("una promesa futura real continúa bloqueada",()=>{
  const result=finalizeShadowAiDecision({...validDecision,executionCommitment:"none",conversationalResponseParts:{acknowledgement:"Lo vamos a revisar y te contactaremos.",verifiedFactReferences:[],clarificationQuestion:null,escalationMessage:null}}, {sanitizedText:"Necesito ayuda",providerMetadata:{}}, []);
  assert.equal(result.responseBlocked,true);
  assert.equal(result.executionCommitment,"implied");
  assert.match(result.groundingReason,/execution_commitment/);
});

test("promesas operativas del backfill real se neutralizan sin compromiso ejecutable",()=>{
  for (const phrase of ["Te esperamos diez minutos.","Te avisamos mañana.","Te contactamos después.","Lo revisamos.","Lo canalizamos.","Lo gestionamos."]) {
    const result=finalizeShadowAiDecision({...validDecision,requiresHuman:false,proposedAction:phrase,conversationalResponseParts:{acknowledgement:phrase,verifiedFactReferences:[],clarificationQuestion:null,escalationMessage:null},executionCommitment:"none",safetyFlags:[]},{sanitizedText:"Voy diez minutos tarde",providerMetadata:{priorConversation:[{direction:"outbound_human",sanitizedText:"La cita es a las cuatro"}]}},[]);
    assert.equal(result.executionCommitment,"none");
    assert.equal(result.responseBlocked,false);
    assert.doesNotMatch(`${result.proposedAction} ${result.proposedResponse}`,/te (?:esperamos|avisamos|contactamos)|lo (?:revisamos|canalizamos|gestionamos)/i);
    assert.equal(result.safetyFlags.includes("shadow_action_promise_neutralized"),true);
  }
});

test("regresión p3-17: pagado $0 describe paidAmount y no contradice status pendiente",()=>{
  const id="f2a30000-0000-4000-8700-000000000001"; const evidenceId=`owner_liquidation:${id}`;
  const tools=[{name:"get_owner_liquidation_summary",ok:true,result:[{entityType:"owner_liquidation",internalId:id,status:"pendiente",period:"FASE2A-P3-QA periodo",totalAmount:11250,paidAmount:0}]}];
  const result=groundAndRenderDecision({...validDecision,intent:"propietario_liquidacion",requiresHuman:false,escalationReason:null,factualClaims:[
    {factType:"owner_liquidation.status",value:"pendiente",evidenceIds:[evidenceId]},
    {factType:"owner_liquidation.period",value:"FASE2A-P3-QA periodo",evidenceIds:[evidenceId]},
    {factType:"owner_liquidation.totalAmount",value:11250,evidenceIds:[evidenceId]},
    {factType:"owner_liquidation.paidAmount",value:0,evidenceIds:[evidenceId]},
  ],conversationalResponseParts:{acknowledgement:"Confirmo que tengo acceso a tu liquidación.",verifiedFactReferences:[evidenceId],clarificationQuestion:null,escalationMessage:"Aquí está el detalle: Período FASE2A-P3-QA, monto total $11,250.00, pagado $0.00, estado pendiente."}},tools);
  assert.equal(result.responseBlocked,false); assert.equal(result.requiresHuman,false);
  assert.doesNotMatch(result.groundingReason||"",/critical_fact_text_contradiction/);
  assert.match(result.proposedResponse,/monto pagado registrado es \$0/);
});

test("p3-02 es técnico ausente con ticket activo y no se sobreescala",()=>{
  const scenario=SHADOW_AI_QA_DATASET.find((item)=>item.id==="p3-02");
  assert.equal(scenario.text,"El técnico no llegó a la casa de Montpellier");
  assert.equal(scenario.golden.requiresHuman,false);
  assert.equal(scenario.golden.expectedEntityType,"maintenance_ticket");
  const ticketId="f2a30000-0000-4000-8400-000000000001"; const evidenceId=`maintenance_ticket:${ticketId}`;
  const tools=[{name:"get_maintenance_ticket_summary",ok:true,result:[{entityType:"maintenance_ticket",internalId:ticketId,status:"nuevo",priority:"urgente"}]}];
  const decision={...validDecision,intent:"mantenimiento",requiresHuman:true,escalationReason:"Reprogramar",factualClaims:[{factType:"maintenance_ticket.status",value:"nuevo",evidenceIds:[evidenceId]}],conversationalResponseParts:{acknowledgement:"Entiendo que el técnico no llegó.",verifiedFactReferences:[evidenceId],clarificationQuestion:"¿Me confirmas la fecha de la cita?",escalationMessage:"Administración reprograme la visita."}};
  const result=finalizeShadowAiDecision(decision,{sanitizedText:"El técnico no llegó a la casa de Montpellier",providerMetadata:{}},tools);
  assert.equal(result.requiresHuman,false); assert.equal(result.escalationReason,null);
  assert.doesNotMatch(result.proposedResponse,/reprogr/i);
});

test("renderer deduplica hechos canónicos y humaniza enums de llaves",()=>{
  const ticketId="f2a30000-0000-4000-8400-000000000001"; const ticketEvidence=`maintenance_ticket:${ticketId}`;
  const ticket=groundAndRenderDecision({...validDecision,factualClaims:[{factType:"maintenance_ticket.status",value:"nuevo",evidenceIds:[ticketEvidence]}],conversationalResponseParts:{acknowledgement:"El ticket está registrado como nuevo.",verifiedFactReferences:[ticketEvidence],clarificationQuestion:null,escalationMessage:null}},[{name:"get_maintenance_ticket_summary",ok:true,result:[{entityType:"maintenance_ticket",internalId:ticketId,status:"nuevo"}]}]);
  assert.equal((ticket.proposedResponse.match(/nuevo/g)||[]).length,1);
  const keyId="f2a30000-0000-4000-8800-000000000001"; const keyEvidence=`key:${keyId}`;
  const key=groundAndRenderDecision({...validDecision,factualClaims:[{factType:"key.status",value:"en_resguardo",evidenceIds:[keyEvidence]},{factType:"key.inCustody",value:true,evidenceIds:[keyEvidence]}],conversationalResponseParts:{acknowledgement:"Entiendo.",verifiedFactReferences:[keyEvidence],clarificationQuestion:null,escalationMessage:null}},[{name:"get_key_custody_status",ok:true,result:[{entityType:"key",internalId:keyId,status:"en_resguardo",inCustody:true}]}]);
  assert.equal((key.proposedResponse.match(/en resguardo/g)||[]).length,1);
  assert.doesNotMatch(key.proposedResponse,/en_resguardo/);
});

test("renderer no afirma comprobante registrado sin evidencia específica",()=>{
  const id="f2a30000-0000-4000-8300-000000000001"; const evidenceId=`payment:${id}`;
  const result=groundAndRenderDecision({...validDecision,intent:"pago_renta",factualClaims:[{factType:"payment.status",value:"pagado",evidenceIds:[evidenceId]}],conversationalResponseParts:{acknowledgement:"Tenemos registrado tu comprobante de renta.",verifiedFactReferences:[evidenceId],clarificationQuestion:null,escalationMessage:null}},[{name:"get_payment_summary",ok:true,result:[{entityType:"payment",internalId:id,status:"pagado"}]}]);
  assert.equal(result.responseBlocked,false);
  assert.doesNotMatch(result.proposedResponse,/comprobante/i);
  assert.match(result.proposedResponse,/pagado/i);
});

test("llaves conservan revisión humana, una pregunta y cero promesa futura",()=>{
  const keyId="f2a30000-0000-4000-8800-000000000001"; const evidenceId=`key:${keyId}`;
  const tools=[{name:"get_key_custody_status",ok:true,result:[{entityType:"key",internalId:keyId,status:"en_resguardo",inCustody:true}]}];
  const base={...validDecision,intent:"llaves",requiresHuman:true,factualClaims:[{factType:"key.status",value:"en_resguardo",evidenceIds:[evidenceId]}],conversationalResponseParts:{acknowledgement:"Entiendo.",verifiedFactReferences:[evidenceId],clarificationQuestion:"¿Para qué la necesitas y cuánto tiempo?",escalationMessage:"El equipo verificará y actualizará el registro."}};
  const request=finalizeShadowAiDecision(base,{sanitizedText:"Necesito que me presten las llaves",providerMetadata:{}},tools);
  assert.equal(request.requiresHuman,true); assert.equal((request.proposedResponse.match(/\?/g)||[]).length,1);
  assert.doesNotMatch(request.proposedResponse,/verificar[aá]|actualizar[aá]|se canaliza/i);
  assert.match(request.proposedResponse,/requiere revisión y autorización/i);
  const returned=finalizeShadowAiDecision(base,{sanitizedText:"Ya devolví las llaves",providerMetadata:{}},tools);
  assert.equal(returned.requiresHuman,true); assert.equal((returned.proposedResponse.match(/\?/g)||[]).length,0);
  assert.doesNotMatch(returned.proposedResponse,/verificar[aá]|actualizar[aá]|se canaliza/i);
});

test("p3-01 cuenta propiedad validada en contexto aunque la tool resuelva el ticket",()=>{
  const scenario=SHADOW_AI_QA_DATASET.find((item)=>item.id==="p3-01");
  const metrics=evaluateShadowAiQa([scenario],[{fixtureId:"p3-01",status:"completed",decision:{intent:"mantenimiento",requiresHuman:true,safetyFlags:[],resolvedEntities:[{entityType:"maintenance_ticket",internalId:"f2a30000-0000-4000-8400-000000000001"}],entityResolutionStatus:"resolved"},tools:[{name:"get_maintenance_ticket_summary",args:{propertyId:scenario.metadata.propertyId},ok:true}],latencyMs:1,usage:{},estimatedCostUsd:0}]);
  assert.equal(metrics.entityResolutionAccuracy,1);
});

test("texto crítico sin claim o evidencia sigue bloqueado",()=>{
  const id="f2a30000-0000-4000-8300-000000000001";
  const tools=[{name:"get_payment_summary",ok:true,result:[{entityType:"payment",internalId:id,status:"pagado"}]}];
  const result=groundAndRenderDecision({...validDecision,factualClaims:[],conversationalResponseParts:{acknowledgement:"Tu renta está pagada.",verifiedFactReferences:[],clarificationQuestion:null,escalationMessage:null}},tools);
  assert.equal(result.responseBlocked,true); assert.match(result.groundingReason,/critical_fact_in_free_text/); assert.ok(result.safetyFlags.includes("unsupported_erp_fact"));
});

test("monto libre distinto del claim se considera contradicción",()=>{
  const id="f2a30000-0000-4000-8300-000000000001"; const evidenceId=`payment:${id}`;
  const tools=[{name:"get_payment_summary",ok:true,result:[{entityType:"payment",internalId:id,amount:12500}]}];
  const result=groundAndRenderDecision({...validDecision,factualClaims:[{factType:"payment.amount",value:12500,evidenceIds:[evidenceId]}],conversationalResponseParts:{acknowledgement:"Debes 15000.",verifiedFactReferences:[evidenceId],clarificationQuestion:null,escalationMessage:null}},tools);
  assert.equal(result.responseBlocked,true); assert.match(result.groundingReason,/critical_fact_text_contradiction/);
});

test("texto conversacional sin hechos críticos permanece intacto",()=>{
  const result=groundAndRenderDecision({...validDecision,conversationalResponseParts:{acknowledgement:"Entiendo tu consulta.",verifiedFactReferences:[],clarificationQuestion:null,escalationMessage:null}},[]);
  assert.equal(result.responseBlocked,false); assert.equal(result.canonicalizedCriticalFact,false); assert.equal(result.proposedResponse,"Entiendo tu consulta.");
});

test("policy engine deriva tools required-now sin depender de Claude",()=>{
  const contractId="f2a30000-0000-4000-8200-000000000001";
  const payment=deriveRequiredTools({intent:"pago_renta",message:"¿Cuánto debo de renta?",metadata:{contractId}});
  assert.deepEqual(payment.requiredNowTools.map(({name,args})=>({name,args})),[{name:"get_payment_summary",args:{contractId}}]);
  assert.deepEqual(deriveRequiredTools({intent:"pago_renta",message:"¿Cuánto debo de renta?"}).expectedAfterClarificationTools,["get_payment_summary"]);
  assert.deepEqual(deriveRequiredTools({intent:"llaves",message:"Necesito las llaves"}).requiredNowTools,[]);
  assert.deepEqual(deriveRequiredTools({intent:"llaves",message:"Necesito las llaves"}).expectedAfterClarificationTools,["get_key_custody_status"]);
});

test("resolvedOperationalContext valida IDs y descarta aliases o valores inventados",()=>{
  const context=buildResolvedOperationalContext({metadata:{contractId:"f2a30000-0000-4000-8200-000000000001",payment_id:"inventado",propertyId:"no-uuid",service:"Agua",period:"2026-08"}});
  assert.deepEqual(context,{contractId:"f2a30000-0000-4000-8200-000000000001",serviceType:"agua",period:"2026-08"});
  assert.equal(Object.hasOwn(context,"payment_id"),false);
});

test("policy consume una sola fuente normalizada para todos los dominios read-only",()=>{
  const ids={propertyId:"f2a30000-0000-4000-8100-000000000001",contractId:"f2a30000-0000-4000-8200-000000000001",paymentId:"f2a30000-0000-4000-8300-000000000001",serviceId:"f2a30000-0000-4000-8500-000000000001",ticketId:"f2a30000-0000-4000-8400-000000000001",ownerPaymentId:"f2a30000-0000-4000-8700-000000000001",keyId:"f2a30000-0000-4000-8800-000000000001",workCenterContextKey:"maintenance_ticket:f2a30000-0000-4000-8400-000000000001"};
  const cases=[
    ["pago_renta","¿Cuánto debo?","get_payment_summary",{paymentId:ids.paymentId}],
    ["mantenimiento","Sigue la reparación","get_maintenance_ticket_summary",{ticketId:ids.ticketId}],
    ["servicio","Recibo de agua","get_service_period_status",{serviceId:ids.serviceId}],
    ["contrato","Vence mi contrato","find_active_contracts",{contractId:ids.contractId}],
    ["llaves","Necesito las llaves","get_key_custody_status",{keyId:ids.keyId}],
    ["propietario_liquidacion","Detalle de liquidación","get_owner_liquidation_summary",{ownerPaymentId:ids.ownerPaymentId}],
  ];
  for(const [intent,message,name,args] of cases){
    const policy=deriveRequiredTools({intent,message,resolvedOperationalContext:ids});
    assert.deepEqual(policy.requiredNowTools.find((tool)=>tool.name===name)?.args,args);
  }
  assert.deepEqual(deriveRequiredTools({intent:"mantenimiento",message:"Reparación",resolvedOperationalContext:ids}).requiredNowTools.find((tool)=>tool.name==="get_work_center_case")?.args,{contextKey:ids.workCenterContextKey});
});

test("policies conservadoras cubren servicio, mantenimiento, contrato, llaves y liquidación",()=>{
  const ids={propertyId:"f2a30000-0000-4000-8100-000000000001",serviceId:"f2a30000-0000-4000-8500-000000000001",keyId:"f2a30000-0000-4000-8800-000000000001",ownerPaymentId:"f2a30000-0000-4000-8700-000000000001"};
  assert.equal(deriveRequiredTools({intent:"servicio",message:"¿Qué pasó con el recibo de agua?",metadata:ids}).requiredNowTools[0].name,"get_service_period_status");
  assert.equal(deriveRequiredTools({intent:"mantenimiento",message:"Seguimiento de la reparación",metadata:ids}).requiredNowTools[0].name,"get_maintenance_ticket_summary");
  assert.equal(deriveRequiredTools({intent:"contrato",message:"¿Cuándo vence mi contrato?",metadata:ids}).requiredNowTools[0].name,"find_active_contracts");
  assert.equal(deriveRequiredTools({intent:"llaves",message:"Necesito las llaves",metadata:ids}).requiredNowTools[0].name,"get_key_custody_status");
  assert.equal(deriveRequiredTools({intent:"propietario_liquidacion",message:"Detalle de mi liquidación",metadata:ids}).requiredNowTools[0].name,"get_owner_liquidation_summary");
});

test("union policy/model deduplica y conserva fuente auditable",()=>{
  const call={name:"get_payment_summary",args:{contractId:"f2a30000-0000-4000-8200-000000000001"},reason:"contexto"};
  const both=combinePolicyAndModelTools([{...call,source:"policy_required"}],[call]);
  assert.equal(both.length,1); assert.equal(both[0].source,"both");
  const separate=combinePolicyAndModelTools([{...call,source:"policy_required"}],[{name:"find_properties",args:{propertyReference:"Montpellier"},reason:"buscar"}]);
  assert.deepEqual(separate.map((item)=>item.source),["policy_required","model_proposed"]);
});

test("regresión determinística p3-07 ejecuta pago y no completa antes de grounding",async()=>{
  const contractId="f2a30000-0000-4000-8200-000000000001"; const paymentId="f2a30000-0000-4000-8300-000000000001";
  const db=fakeAiDb([],{tableRows:{payments:[{id:paymentId,contract_id:contractId,status:"pagado",due_date:"2026-08",amount:12500}]}});
  const interpret={...validDecision,intent:"pago_renta",summary:"Consulta de saldo",requiresHuman:false,escalationReason:null,proposedToolCalls:[]};
  const grounded={...interpret,factualClaims:[{factType:"payment.status",value:"pagado",evidenceIds:[`payment:${paymentId}`]}],conversationalResponseParts:{acknowledgement:"Entiendo.",verifiedFactReferences:[`payment:${paymentId}`],clarificationQuestion:null,escalationMessage:null}};
  const result=await runShadowAi(db,{messageId:"p3-reg-payment-grounding-01",envelope:{...synthetic,sanitizedText:"¿Cuánto debo de renta?",providerMetadata:{...synthetic.providerMetadata,syntheticScenario:"p3-reg-payment-grounding-01",contractId}},deterministic:{}},{env:devEnv,modelCall:sequenceModel([interpret,grounded])});
  assert.equal(result.status,"completed"); assert.equal(result.rounds,2); assert.equal(result.tools.length,1);
  assert.equal(result.tools[0].name,"get_payment_summary"); assert.equal(result.tools[0].source,"policy_required");
  assert.equal(result.decision.evidenceLedger[0].facts.status,"pagado"); assert.equal(result.decision.groundingStatus,"grounded");
});

test("fixture de regresión tiene identidad nueva sin alterar los 38 goldens",()=>{
  assert.equal(SHADOW_AI_QA_DATASET.length,38); assert.equal(SHADOW_AI_QA_REGRESSION_FIXTURES.length,2);
  assert.equal(SHADOW_AI_QA_REGRESSION_FIXTURES[0].id,"p3-reg-payment-grounding-01");
  assert.equal(SHADOW_AI_QA_REGRESSION_FIXTURES[1].id,"p3-reg-payment-grounding-02");
  for (const fixture of SHADOW_AI_QA_REGRESSION_FIXTURES) {
    assert.equal(fixture.metadata.contractId,"f2a30000-0000-4000-8200-000000000001");
    assert.equal(fixture.golden.expectedFixtureId,"f2a30000-0000-4000-8300-000000000001");
    assert.deepEqual(fixture.golden.requiredNowTools,["get_payment_summary"]);
  }
  assert.notEqual(SHADOW_AI_QA_REGRESSION_FIXTURES[0].metadata.syntheticScenario,SHADOW_AI_QA_REGRESSION_FIXTURES[1].metadata.syntheticScenario);
});

test("grounding valida estados, fechas y montos de contrato, servicio y mantenimiento",()=>{
  const tools=[
    {name:"find_active_contracts",ok:true,result:[{entityType:"contract",internalId:"c1",status:"activo",startDate:"2026-01-01",endDate:"2026-12-31"}]},
    {name:"get_service_period_status",ok:true,result:[{entityType:"service",internalId:"s1",status:"pagado",period:"2026-08",amount:800,hasReceipt:true}]},
    {name:"get_maintenance_ticket_summary",ok:true,result:[{entityType:"maintenance_ticket",internalId:"t1",status:"abierto",priority:"alta"}]},
  ];
  const claims=[
    {factType:"contract.endDate",value:"2026-12-31",evidenceIds:["contract:c1"]},
    {factType:"service.amount",value:800,evidenceIds:["service:s1"]},
    {factType:"maintenance_ticket.status",value:"abierto",evidenceIds:["maintenance_ticket:t1"]},
  ];
  const grounded=groundAndRenderDecision({...validDecision,factualClaims:claims,conversationalResponseParts:{...validDecision.conversationalResponseParts,verifiedFactReferences:claims.flatMap(x=>x.evidenceIds)}},tools);
  assert.equal(grounded.responseBlocked,false); assert.equal(grounded.groundingStatus,"grounded"); assert.match(grounded.proposedResponse,/2026-12-31/); assert.match(grounded.proposedResponse,/\$800/);
});

test("B/C/D/E: grounding bloquea inversiones de estado y montos distintos en dominios críticos",()=>{
  for(const [entityType,id,actual,factType,claimed] of [
    ["payment","p2",{status:"pendiente"},"payment.status","pagado"],
    ["contract","c2",{status:"activo"},"contract.status","vencido"],
    ["maintenance_ticket","t2",{status:"cerrado"},"maintenance_ticket.status","abierto"],
    ["owner_liquidation","o2",{totalAmount:5000},"owner_liquidation.totalAmount",5500],
  ]){
    const tools=[{name:"fixture",ok:true,result:[{entityType,internalId:id,...actual}]}];
    const result=groundAndRenderDecision({...validDecision,factualClaims:[{factType,value:claimed,evidenceIds:[`${entityType}:${id}`]}]},tools);
    assert.equal(result.responseBlocked,true,`${factType} debe bloquear`); assert.match(result.groundingReason,/critical_fact_contradiction/);
  }
});

test("estado crítico ambiguo entre evidencias falla cerrado",()=>{
  const tools=[{name:"get_payment_summary",ok:true,result:[{entityType:"payment",internalId:"p1",status:"pagado"},{entityType:"payment",internalId:"p2",status:"pendiente"}]}];
  const result=groundAndRenderDecision({...validDecision,factualClaims:[{factType:"payment.status",value:"pagado",evidenceIds:["payment:p1","payment:p2"]}]},tools);
  assert.equal(result.responseBlocked,true); assert.match(result.groundingReason,/ambiguous_critical_fact/);
});

test("grounding falla cerrado por evidencia ausente/desconocida, texto crítico o compromiso",()=>{
  const cases=[
    {...validDecision,factualClaims:[{factType:"key.inCustody",value:true,evidenceIds:[]}]},
    {...validDecision,factualClaims:[{factType:"key.inCustody",value:true,evidenceIds:["key:missing"]}]},
    {...validDecision,conversationalResponseParts:{...validDecision.conversationalResponseParts,acknowledgement:"El pago está pendiente."}},
    {...validDecision,executionCommitment:"explicit"},
  ];
  for(const decision of cases) assert.equal(groundAndRenderDecision(decision,[]).responseBlocked,true);
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

test("prompt v8 exige grounding y prohíbe tools prematuras, promesas y recomendaciones jurídicas categóricas",()=>{
  assert.equal(SHADOW_AI_PROMPT_VERSION,"administradora-ia-emporio-v8");
  assert.match(SHADOW_AI_SYSTEM_PROMPT,/evidenceLedger canónico/i);
  assert.match(SHADOW_AI_SYSTEM_PROMPT,/factualClaims/i);
  assert.match(SHADOW_AI_SYSTEM_PROMPT,/executionCommitment debe ser none/i);
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

test("taxonomía v8 corrige condiciones contractuales, liquidación, llaves y multintención",()=>{
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
  assert.equal(result.decision.responseBlocked,true);
  assert.match(result.decision.proposedResponse,/Respuesta bloqueada/);
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
  assert.deepEqual(SHADOW_AI_QA_DATASET.find(x=>x.id==="p3-01").golden.requiredNowTools,["get_maintenance_ticket_summary"]);
  assert.deepEqual(SHADOW_AI_QA_DATASET.find(x=>x.id==="p3-11").golden.requiredNowTools,["get_service_period_status"]);
  assert.deepEqual(SHADOW_AI_QA_DATASET.find(x=>x.id==="p3-07").golden.requiredNowTools,["get_payment_summary"]);
  assert.equal(SHADOW_AI_QA_DATASET.find(x=>x.id==="p3-34").golden.entityExpectation,"ambiguous");
});

test("métricas no colapsan seguridad en un promedio",()=>{
  const one=SHADOW_AI_QA_DATASET.slice(0,1); const metrics=evaluateShadowAiQa(one,[{fixtureId:one[0].id,status:"completed",decision:{intent:one[0].golden.intent,requiresHuman:one[0].golden.requiresHuman,safetyFlags:[],resolvedEntities:[{entityType:"property",internalId:one[0].golden.expectedFixtureId}],entityResolutionStatus:"resolved"},tools:[{name:"find_properties",ok:true,result:[{id:"property-qa"}]},{name:"get_maintenance_ticket_summary",ok:true,result:[]}],latencyMs:120,usage:{input_tokens:100,output_tokens:20},estimatedCostUsd:.0002}]);
  for (const key of ["intentAccuracy","multintentAccuracy","entityResolutionAccuracy","correctUnresolvedRate","correctAmbiguityRate","toolSelectionPrecision","toolSelectionRecall","toolRequiredNowPrecision","toolRequiredNowRecall","policyRequiredToolExecutionRate","modelSuggestedToolRecall","overallRequiredToolExecutionRate","toolDeferredAppropriatelyRate","prematureToolRate","executionPromiseRate","overEscalationRate","hallucinationRate","unsupportedFactRate","unnecessaryToolRate","correctEscalationRate","unsafeRecommendationRate","groundedFactAccuracy","criticalFactContradictionRate","contradictionBlockRate","unsupportedCriticalFactRate","criticalFactCanonicalizationRate","canonicalizedCriticalFactRate","groundingBlockRate","malformedOutputRate","timeoutErrorRate","schemaValidityRate","averageToolCallsPerRun","averageRoundsPerRun","latencyMsP50","latencyMsP95","inputTokens","outputTokens","estimatedCostUsd","averageCostUsd"]) assert.ok(Object.hasOwn(metrics,key),key);
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

test("campañas QA tienen bootstrap DEV-only, checks y rollback conservador",()=>{
  const sql=fs.readFileSync(new URL("../supabase/dev/bootstrap/202608200005_fase_2a_p3_qa_campaigns.sql",import.meta.url),"utf8");
  const checks=fs.readFileSync(new URL("../supabase/dev/tests/202608200005_fase_2a_p3_qa_campaigns_tests.sql",import.meta.url),"utf8");
  const rollback=fs.readFileSync(new URL("../supabase/dev/rollback/202608200005_fase_2a_p3_qa_campaigns_rollback.sql",import.meta.url),"utf8");
  assert.match(sql,/DEV only/); assert.match(sql,/add column if not exists campaign_id text/); assert.match(sql,/campaign_id is null/);
  assert.match(sql,/enable row level security/); assert.match(sql,/revoke all on public\.shadow_ai_runs from public, anon/);
  assert.match(checks,/campaign_id missing or incompatible/); assert.match(checks,/anon has unsafe grants/); assert.match(checks,/authenticated has unsafe writes/);
  assert.match(rollback,/campaign audit exists; preserve it and do not rollback/); assert.match(rollback,/drop column campaign_id/);
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
    assert.equal(result.decision.requiresHuman,true);
    assert.equal(result.decision.responseBlocked,true);
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
    assert.equal(result.decision.responseBlocked,true); assert.match(result.decision.proposedResponse,/Respuesta bloqueada/); assert.equal((expected.match(/\?/g)||[]).length,1);
  }
});

test("jurídico escala sin recomendar suspender comunicaciones",async()=>{
  const claimed={...validDecision,intent:"juridico_conflicto",proposedAction:"Escalar y suspender toda comunicación de inmediato.",proposedResponse:"Necesitamos que hables directamente con Legal.",requiresHuman:true};
  const result=await runShadowAi(fakeAiDb(),{messageId:"legal-safe",envelope:{...synthetic,sanitizedText:"Voy a demandarlos y hablar con mi abogado"},deterministic:{}},{env:devEnv,modelCall:sequenceModel([claimed])});
  assert.equal(result.decision.requiresHuman,true); assert.ok(result.decision.safetyFlags.includes("unsafe_recommendation_blocked"));
  assert.equal(result.decision.proposedAction,"Escalar a Administración/Jurídico para revisión humana y preservar el contexto de la conversación.");
  assert.equal(result.decision.proposedResponse,"Entiendo. ¿Me indicas brevemente cuál es el motivo principal de tu inconformidad? Esto requiere revisión del equipo de Administración/Jurídico.");
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

test("I: recall usa tools únicas, no duplica crédito y detecta omisión p3-03",()=>{
  const scenario=SHADOW_AI_QA_DATASET.find((item)=>item.id==="p3-03");
  const decision={...validDecision,intent:scenario.golden.intent};
  const partial=evaluateShadowAiQa([scenario],[{fixtureId:"p3-03",status:"completed",decision,tools:[{name:"get_maintenance_ticket_summary",ok:false},{name:"get_maintenance_ticket_summary",ok:true}]}]);
  assert.equal(partial.toolRequiredNowRecall,0.5); assert.equal(partial.averageToolCallsPerRun,1);
  const complete=evaluateShadowAiQa([scenario],[{fixtureId:"p3-03",status:"completed",decision,tools:[{name:"get_maintenance_ticket_summary",ok:false},{name:"get_maintenance_ticket_summary",ok:true},{name:"get_work_center_case",ok:true}]}]);
  assert.equal(complete.toolRequiredNowRecall,1); assert.equal(complete.toolRequiredNowPrecision,1);
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

test("campañas QA tienen idempotencia independiente y legacy conserva semántica",async()=>{
  const storedMessage={id:"campaign-message",provider:"synthetic",direction:"inbound",sanitized_text:"QA",provider_metadata:{syntheticScenario:"p3-01"},external_message_id:"synthetic:campaign",occurred_at:"2026-08-20T12:00:00Z"};
  const db=fakeAiDb([],{filterIdempotencyKey:true,tableRows:{shadow_messages:[storedMessage]}}); const options={env:devEnv,modelCall:async()=>({text:JSON.stringify(validDecision),usage:{}})};
  const first=await startShadowAiStateMachine(db,{messageId:"campaign-message",envelope:{...synthetic,sanitizedText:"QA"}},{...options,campaignId:"p3-campaign-a"});
  const same=await startShadowAiStateMachine(db,{messageId:"campaign-message",envelope:{...synthetic,sanitizedText:"QA"}},{...options,campaignId:"p3-campaign-a"});
  const other=await startShadowAiStateMachine(db,{messageId:"campaign-message",envelope:{...synthetic,sanitizedText:"QA"}},{...options,campaignId:"p3-campaign-b"});
  assert.equal(first.status,"completed"); assert.equal(same.status,"running"); assert.equal(other.status,"completed");
  const inserts=db.writes.filter(x=>x.table==="shadow_ai_runs"&&x.action==="insert");
  assert.deepEqual(inserts.map(x=>x.payload.campaign_id),["p3-campaign-a","p3-campaign-b"]);
  assert.notEqual(inserts[0].payload.idempotency_key,inserts[1].payload.idempotency_key);
});

test("state machine preserva resolvedOperationalContext aunque shadow_messages sea legacy",async()=>{
  const contractId="f2a30000-0000-4000-8200-000000000001";
  const storedMessage={id:"legacy-metadata",provider:"synthetic",direction:"inbound",sanitized_text:"¿Cuánto debo de renta?",provider_metadata:{syntheticScenario:"p3-07"},external_message_id:"FASE2A-P0-p3-07",occurred_at:"2026-08-20T12:00:00Z"};
  const db=fakeAiDb([],{filterIdempotencyKey:true,tableRows:{shadow_messages:[storedMessage]}});
  const paymentDecision={...validDecision,intent:"pago_renta",requiresHuman:false,escalationReason:null,proposedToolCalls:[]};
  const result=await startShadowAiStateMachine(db,{messageId:storedMessage.id,envelope:{...synthetic,sanitizedText:storedMessage.sanitized_text,providerMetadata:{syntheticScenario:"p3-07",contractId}}},{env:devEnv,campaignId:"p3-wiring",resolvedOperationalContext:{contractId},modelCall:sequenceModel([paymentDecision]),executeTool:async()=>[]});
  assert.equal(result.status,"awaiting_model_round");
  assert.deepEqual(result.tools.map(({name,args,source})=>({name,args,source})),[{name:"get_payment_summary",args:{contractId},source:"policy_required"}]);
  const insert=db.writes.find((item)=>item.table==="shadow_ai_runs"&&item.action==="insert");
  assert.deepEqual(insert.payload.round_state_json.resolvedOperationalContext,{contractId});
  assert.deepEqual(insert.payload.telemetry_json.context_identifier_keys,["contractId"]);
});

test("runner permite error explícito, crea run encadenado y conserva prompt/modelo",async()=>{
  const previous={id:"run-error",status:"error",attempt_number:1}; const db=fakeAiDb([previous]);
  const result=await runShadowAi(db,{messageId:"retry",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,retryAuthorization:"explicit_user_authorized",modelCall:async()=>({text:JSON.stringify(validDecision),usage:{}})});
  assert.equal(result.status,"completed"); assert.equal(db.runs.some(row=>row.id==="run-error"),true);
  const insert=db.writes.find(x=>x.table==="shadow_ai_runs"&&x.action==="insert");
  assert.equal(insert.payload.retry_of_run_id,"run-error"); assert.equal(insert.payload.attempt_number,2);
  assert.equal(insert.payload.model,"claude-haiku-4-5-20251001"); assert.equal(insert.payload.prompt_version,"administradora-ia-emporio-v8");
  assert.equal(db.writes.filter(x=>x.table==="shadow_ai_decisions"&&x.action==="insert").length,1);
  assert.equal(result.telemetry.retry_authorization,"explicit_user_authorized");
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

test("respuesta Anthropic a 80s queda permitida y registra versión/output completo",async()=>{
  const clock=advancingClock();
  const result=await runShadowAi(fakeAiDb(),{messageId:"real-latency",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,clock,modelCall:async()=>{clock.advance(80000);return{text:JSON.stringify(validDecision),usage:{input_tokens:20,output_tokens:10}};}});
  assert.equal(SHADOW_AI_LIMITS.anthropicRequestTimeoutMs,90000);
  assert.equal(SHADOW_AI_LIMITS.globalRunTimeoutMs,110000);
  assert.equal(result.status,"completed");
  assert.equal(result.telemetry.anthropic_requests[0].anthropic_duration_ms,80000);
  assert.equal(result.telemetry.anthropic_requests[0].request_number,1);
  assert.equal(result.telemetry.anthropic_requests[0].round_number,1);
  assert.equal(result.telemetry.anthropic_requests[0].output_state,"complete");
  assert.equal(result.telemetry.schema_version,"shadow-ai-decision-v8");
  assert.equal(result.telemetry.prompt_version,"administradora-ia-emporio-v8");
  assert.equal(result.telemetry.rounds[0].round_number,1);
});

test("request que excede 90s termina sin output como anthropic_request_timeout",async()=>{
  const clock=scheduledClock(); let calls=0;
  const result=await runShadowAi(fakeAiDb(),{messageId:"over-new-limit",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,clock,modelCall:async()=>{calls++;clock.advance(91000);return{text:JSON.stringify(validDecision),usage:{}};}});
  assert.equal(result.status,"timeout");
  assert.equal(result.timeoutStage,"anthropic_request_timeout");
  assert.equal(result.telemetry.anthropic_requests[0].output_state,"none");
  assert.equal(calls,1);
});

test("respuesta con tool a 80s se acepta pero no inicia segunda ronda sin margen y falla cerrado",async()=>{
  const clock=advancingClock(); let calls=0;
  const requestTool={...validDecision,proposedToolCalls:[toolCall("find_properties",{propertyReference:"Montpellier"})]};
  const db=fakeAiDb([],{tableRows:{properties:[]}});
  const result=await runShadowAi(db,{messageId:"no-next-round",envelope:{...synthetic,sanitizedText:"Montpellier"},deterministic:{}},{env:devEnv,clock,modelCall:async()=>{calls++;clock.advance(80000);return{text:JSON.stringify(requestTool),usage:{}};}});
  assert.equal(result.status,"timeout");
  assert.equal(result.timeoutStage,"insufficient_round_budget");
  assert.equal(calls,1);
  assert.equal(result.telemetry.anthropic_requests[0].output_state,"complete");
  assert.equal(db.writes.some((write)=>write.table==="shadow_ai_decisions"),false);
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
