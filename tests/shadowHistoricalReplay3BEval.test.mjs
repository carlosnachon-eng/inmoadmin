import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assertHistoricalReplayIsolation, executeHistoricalReplayCase, historicalReplayMetrics, HISTORICAL_REPLAY_MAX_CASES, HISTORICAL_REPLAY_RUNTIME, normalizeHistoricalReplayDecision, selectHistoricalReplayCohort } from "../lib/shadow/ai/historicalReplay.js";

const env={SHADOW_HISTORICAL_REPLAY_ENABLED:"true",SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED:"true",SHADOW_ADMIN_OUTBOUND_ENABLED:"false",SHADOW_OUTBOUND_ENABLED:"false",SHADOW_RESPOND_ADMIN_CHANNEL_ID:"544519",SHADOW_IDENTITY_BRIDGE_ENABLED:"true"};
const conversation={id:"conversation-1",provider:"respond_admin",channel:"544519",respond_contact_id:"contact-opaque"};
const message=(id,direction,seconds,text,conversationId=conversation.id)=>({id,conversation_id:conversationId,external_message_id:`external-${id}`,direction,occurred_at:new Date(Date.parse("2026-08-20T12:00:00Z")+seconds*1000).toISOString(),sanitized_text:text,attachment_metadata:[],provider_metadata:{}});
const validDecision={intent:"mantenimiento",secondaryIntents:[],urgency:"normal",summary:"Fuga",entitiesMentioned:[],resolvedEntities:[],entityResolutionStatus:"not_applicable",informationNeeded:["location"],proposedToolCalls:[],contextAssessment:"Falta ubicación",proposedAction:"Pedir ubicación",factualClaims:[],conversationalResponseParts:{acknowledgement:"Entiendo.",verifiedFactReferences:[],clarificationQuestion:"¿Dónde ocurre?",escalationMessage:null},executionCommitment:"none",confidence:.8,requiresHuman:false,escalationReason:null,safetyFlags:[]};

test("replay falla cerrado con flags apagadas o outbound encendido",()=>{
  assert.throws(()=>assertHistoricalReplayIsolation({...env,SHADOW_HISTORICAL_REPLAY_ENABLED:"false"}),/disabled/);
  assert.throws(()=>assertHistoricalReplayIsolation({...env,SHADOW_OUTBOUND_ENABLED:"true"}),/outbound_fail_closed/);
  assert.throws(()=>assertHistoricalReplayIsolation({...env,SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED:"false"},{requireAnthropic:true}),/anthropic_disabled/);
});

test("selección usa sólo Admin cerrado, separa respuesta humana futura y no excede límites",()=>{
  const messages=[message("i1","inbound",0,"Hay humedad en la pared"),message("i2","inbound",20,"Se ve una mancha"),message("h1","outbound_human",40,"Respuesta posterior que no debe entrar")];
  const selected=selectHistoricalReplayCohort({messages,conversations:[conversation],env,now:Date.parse("2026-08-21T12:00:00Z")});
  assert.equal(selected.cases.length,1); assert.equal(selected.cases[0].domain,"maintenance");
  assert.equal(selected.cases[0].turnSnapshot.sanitizedText.includes("Respuesta posterior"),false);
  assert.equal(selected.cases[0].envelope.sanitizedText.includes("Respuesta posterior"),false);
  assert.equal(selected.cases[0].humanResponseSnapshot,"Respuesta posterior que no debe entrar");
  assert.equal(selected.groundTruthExcludedFromInput,true); assert.ok(selected.selected<=HISTORICAL_REPLAY_MAX_CASES);
});

test("Ventas y QA no entran; una categoría no rellena cupo de otra",()=>{
  const sales={id:"sales",provider:"respond_admin",channel:"498219",respond_contact_id:"s"};
  const messages=[message("s1","inbound",0,"Hay humedad","sales"),message("a1","inbound",0,"PRUEBA SHADOW FASE2A-1")];
  const selected=selectHistoricalReplayCohort({messages,conversations:[conversation,sales],env,now:Date.parse("2026-08-21T12:00:00Z")});
  assert.equal(selected.cases.length,0);
});

test("ejecución aislada reutiliza 3A/3B sin tools ni tablas naturales y conserva grounding",async()=>{
  let modelCalls=0; let toolCalls=0;
  const result=await executeHistoricalReplayCase({}, {evaluationMode:"historical_replay",sufficientHistoricalContext:true,temporalGrounding:"current_state",identityGrounding:"current_canonical_mapping",humanResponseSnapshot:"Respuesta humana posterior",envelope:{provider:"respond_admin",direction:"inbound",sanitizedText:"Hay humedad, ¿me apoyas?",providerMetadata:{channelId:"544519",respondContactId:"contact-opaque",priorConversation:[]}}}, {
    env, now:(()=>{let n=1000;return()=>n+=10;})(), modelCall:async()=>{modelCalls+=1;return{id:"request-secret-ref",text:JSON.stringify(validDecision),usage:{input_tokens:100,output_tokens:20}};}, executeTool:async()=>{toolCalls+=1;return[];},
  });
  assert.equal(modelCalls,1); assert.equal(toolCalls,0); assert.equal(result.evaluationMode,"historical_replay");
  assert.equal(result.temporalGrounding,"current_state"); assert.equal(result.identityGrounding,"current_canonical_mapping");
  assert.equal(result.humanResponseSnapshot,"Respuesta humana posterior"); assert.equal(result.conversationAction.status,"proposed");
  assert.equal(result.providerRequestRefs[0].includes("request-secret-ref"),false); assert.ok(result.estimatedCostUsd>0);
});

test("replay v2 contiene dominio fuera de 3B igual que natural sin ampliar enum",async()=>{
  const decision={...validDecision,intent:"contrato",summary:"Consulta contractual",proposedAction:"Escalar"};
  const result=await executeHistoricalReplayCase({}, {evaluationMode:"historical_replay",sufficientHistoricalContext:true,temporalGrounding:"current_state",identityGrounding:"unresolved",humanResponseSnapshot:null,envelope:{provider:"respond_admin",direction:"inbound",sanitizedText:"Tengo una consulta de contrato",providerMetadata:{channelId:"544519",priorConversation:[]}}}, {
    env, now:(()=>{let n=1000;return()=>n+=10;})(), modelCall:async()=>({id:"req-domain",model:"claude-test",text:JSON.stringify(decision),usage:{input_tokens:80,output_tokens:15}}),
  });
  assert.equal(HISTORICAL_REPLAY_RUNTIME,"administradora-ia-emporio-historical-replay-v3");
  assert.equal(result.operationalResolution.case_domain,"outside_phase_3a");
  assert.equal(result.conversationAction.conversation_action,"no_message");
  assert.equal(result.conversationAction.requires_human,true);
  assert.equal(result.conversationAction.auto_send_eligible,false);
  assert.equal(result.outputDiagnostics.conversationDomainFallback,"no_message");
});

test("normalización replay trunca sólo strings de presentación y conserva requiresHuman",()=>{
  const oversized={...validDecision,summary:"x".repeat(501),contextAssessment:"y".repeat(1001),informationNeeded:["z".repeat(201)],requiresHuman:true};
  const normalized=normalizeHistoricalReplayDecision(oversized);
  assert.equal(normalized.value.summary.length,500); assert.equal(normalized.value.contextAssessment.length,1000);
  assert.equal(normalized.value.informationNeeded[0].length,200); assert.equal(normalized.value.requiresHuman,true);
  assert.deepEqual(normalized.truncatedFields,["summary","contextAssessment","informationNeeded[0]"]);
  assert.equal(oversized.summary.length,501);
});

test("usage del proveedor sobrevive a error estructurado sin persistir output bruto",async()=>{
  const invalid={...validDecision,intent:"enum_inventado"};
  await assert.rejects(async()=>executeHistoricalReplayCase({}, {evaluationMode:"historical_replay",sufficientHistoricalContext:true,temporalGrounding:"current_state",identityGrounding:"unresolved",humanResponseSnapshot:null,envelope:{provider:"respond_admin",direction:"inbound",sanitizedText:"Consulta",providerMetadata:{channelId:"544519",priorConversation:[]}}}, {
    env, now:(()=>{let n=1000;return()=>n+=25;})(), modelCall:async()=>({id:"request-secret-ref",model:"claude-safe-model",text:JSON.stringify(invalid),usage:{input_tokens:321,output_tokens:45}}),
  }), (error)=>{
    assert.equal(error.historicalReplayTelemetry.inputTokens,321); assert.equal(error.historicalReplayTelemetry.outputTokens,45);
    assert.ok(error.historicalReplayTelemetry.estimatedCostUsd>0); assert.ok(error.historicalReplayTelemetry.latencyMs>0);
    assert.equal(error.historicalReplayTelemetry.providerRequestRefs[0].includes("request-secret-ref"),false);
    assert.deepEqual(error.historicalReplayTelemetry.providerModels,["claude-safe-model"]);
    assert.equal("providerOutput" in error.historicalReplayTelemetry,false); assert.equal(JSON.stringify(error.historicalReplayTelemetry).includes("enum_inventado"),false);
    return true;
  });
});

test("identidad histórica sin respondContactId permanece unresolved y fail-closed",()=>{
  const messages=[message("i-missing-contact","inbound",0,"Tengo un pendiente administrativo")];
  const unresolvedConversation={...conversation,respond_contact_id:null};
  const selected=selectHistoricalReplayCohort({messages,conversations:[unresolvedConversation],env,now:Date.parse("2026-08-21T12:00:00Z")});
  assert.equal(selected.cases[0].identityGrounding,"unresolved");
  assert.equal(selected.cases[0].envelope.providerMetadata.respondContactId,"");
});

test("métricas replay permanecen separadas y destacan primeras capabilities",()=>{
  const metrics=historicalReplayMetrics([
    {status:"completed",human_rating:"correct",message_safe:true,would_resolve_without_human:true,conversation_action:"ask_missing_information"},
    {status:"completed",human_rating:"acceptable_with_changes",message_safe:true,would_resolve_without_human:false,conversation_action:"request_document"},
    {status:"not_evaluable",human_rating:"not_evaluable",message_safe:false,would_resolve_without_human:false,conversation_action:"no_message"},
  ]);
  assert.equal(metrics.total,3); assert.equal(metrics.completed,2); assert.equal(metrics.firstOutboundCandidates,2); assert.equal(metrics.safeMessageRate,1);
});

test("schema v2 exige elegibilidad humana y motivo fuera de correcta",()=>{
  const sql=fs.readFileSync(new URL("../supabase/migrations/202608280002_fase_3b_utility_evaluation.sql",import.meta.url),"utf8");
  assert.match(sql,/human_auto_send_eligible is not null/);
  assert.match(sql,/rating = 'correct' or reason is not null/);
  assert.match(sql,/review_schema_version = 'v1'/);
  assert.match(sql,/requested_existing_document/);
});

test("artefactos aíslan tablas naturales, carecen de cron/sender y aplican RLS/grants mínimos",()=>{
  const module=fs.readFileSync(new URL("../lib/shadow/ai/historicalReplay.js",import.meta.url),"utf8");
  const api=fs.readFileSync(new URL("../pages/api/operaciones/shadow-historical-replay.js",import.meta.url),"utf8");
  const sql=fs.readFileSync(new URL("../supabase/migrations/202608280001_fase_3b_eval_historical_replay.sql",import.meta.url),"utf8");
  assert.doesNotMatch(module,/persistConversationAction|startShadowAiStateMachine|shadow_ai_runs|shadow_ai_decisions|shadow_messages.*(?:insert|update)|sendRespond|respondSender/i);
  assert.doesNotMatch(api,/respond.*(?:send|update)|shadow_conversation_actions"\)\.insert|shadow_ai_runs"\)\.(?:insert|update)|shadow_messages"\)\.(?:insert|update)|shadow_conversations"\)\.(?:insert|update)/i);
  assert.match(api,/execute_one/); assert.doesNotMatch(api,/execute_all|replay_all|cron/);
  assert.match(api,/providerRequestRefs/); assert.match(api,/input_tokens/); assert.match(api,/output_tokens/); assert.match(api,/estimated_cost_usd/);
  assert.doesNotMatch(api,/result\.text|providerOutput|rawOutput/);
  assert.match(sql,/enable row level security/); assert.match(sql,/revoke all[\s\S]*service_role/i); assert.doesNotMatch(sql,/status[^\n]*sent/);
});
