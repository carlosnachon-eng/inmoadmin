import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assertHistoricalReplayIsolation, executeHistoricalReplayCase, historicalReplayMetrics, HISTORICAL_REPLAY_MAX_CASES, selectHistoricalReplayCohort } from "../lib/shadow/ai/historicalReplay.js";

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

test("métricas replay permanecen separadas y destacan primeras capabilities",()=>{
  const metrics=historicalReplayMetrics([
    {status:"completed",human_rating:"correct",message_safe:true,would_resolve_without_human:true,conversation_action:"ask_missing_information"},
    {status:"completed",human_rating:"acceptable_with_changes",message_safe:true,would_resolve_without_human:false,conversation_action:"request_document"},
    {status:"not_evaluable",human_rating:"not_evaluable",message_safe:false,would_resolve_without_human:false,conversation_action:"no_message"},
  ]);
  assert.equal(metrics.total,3); assert.equal(metrics.completed,2); assert.equal(metrics.firstOutboundCandidates,2); assert.equal(metrics.safeMessageRate,1);
});

test("artefactos aíslan tablas naturales, carecen de cron/sender y aplican RLS/grants mínimos",()=>{
  const module=fs.readFileSync(new URL("../lib/shadow/ai/historicalReplay.js",import.meta.url),"utf8");
  const api=fs.readFileSync(new URL("../pages/api/operaciones/shadow-historical-replay.js",import.meta.url),"utf8");
  const sql=fs.readFileSync(new URL("../supabase/migrations/202608280001_fase_3b_eval_historical_replay.sql",import.meta.url),"utf8");
  assert.doesNotMatch(module,/persistConversationAction|startShadowAiStateMachine|shadow_ai_runs|shadow_ai_decisions|shadow_messages.*(?:insert|update)|send/i);
  assert.doesNotMatch(api,/respond.*(?:send|update)|shadow_conversation_actions"\)\.insert|shadow_ai_runs"\)\.(?:insert|update)|shadow_messages"\)\.(?:insert|update)|shadow_conversations"\)\.(?:insert|update)/i);
  assert.match(api,/execute_one/); assert.doesNotMatch(api,/execute_all|replay_all|cron/);
  assert.match(sql,/enable row level security/); assert.match(sql,/revoke all[\s\S]*service_role/i); assert.doesNotMatch(sql,/status[^\n]*sent/);
});
