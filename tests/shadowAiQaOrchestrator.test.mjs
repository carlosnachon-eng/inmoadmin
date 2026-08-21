import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { aggregatePersistedShadowQa, executionDisposition, qaCampaignCompatibility, remainingRunBudget, SHADOW_QA_FINAL_CAMPAIGN_ID, SHADOW_QA_MAX_MICRO_BATCH, SHADOW_QA_MIN_RUN_BUDGET_MS, SHADOW_QA_REQUEST_BUDGET_MS, validateExplicitFixtureIds, validateQaCampaignId } from "../lib/shadow/ai/qaOrchestrator.js";
import { SHADOW_AI_QA_DATASET, SHADOW_AI_QA_REGRESSION_FIXTURES } from "../lib/shadow/ai/qaDataset.js";

test("completed se omite y running se bloquea",()=>{
  assert.equal(executionDisposition("completed"),"skip_completed");
  assert.equal(executionDisposition("running"),"block_running");
});

test("error y timeout se reportan sin retry automático",()=>{
  assert.equal(executionDisposition("error"),"report_failed_no_retry");
  assert.equal(executionDisposition("timeout"),"report_failed_no_retry");
});

test("retry explícito sólo habilita error/timeout válidos",()=>{
  assert.equal(executionDisposition("timeout",{retryFailed:true,attemptNumber:1}),"execute_retry");
  assert.equal(executionDisposition("error",{retryFailed:true,attemptNumber:2}),"execute_retry");
  assert.equal(executionDisposition("completed",{retryFailed:true,attemptNumber:1}),"reject_retry_completed");
  assert.equal(executionDisposition("running",{retryFailed:true,attemptNumber:1}),"reject_retry_running");
  assert.equal(executionDisposition("timeout",{retryFailed:true,attemptNumber:3}),"retry_limit_reached");
  assert.equal(executionDisposition("error",{retryFailed:true,attemptNumber:1,hasDecision:true}),"retry_inconsistent");
  assert.equal(executionDisposition(undefined,{retryFailed:true}),"reject_retry_without_failed_run");
});

test("acepta sólo IDs explícitos y limita micro-lote",()=>{
  assert.equal(SHADOW_QA_MAX_MICRO_BATCH,1);
  assert.deepEqual(validateExplicitFixtureIds(["p3-02"]),["p3-02"]);
  assert.deepEqual(validateExplicitFixtureIds(["p3-reg-payment-grounding-01"]),["p3-reg-payment-grounding-01"]);
  assert.deepEqual(validateExplicitFixtureIds(["p3-reg-payment-grounding-02"]),["p3-reg-payment-grounding-02"]);
  assert.throws(()=>validateExplicitFixtureIds([]),/invalid_fixture_batch/);
  assert.throws(()=>validateExplicitFixtureIds(["p3-01","p3-02"]),/invalid_fixture_batch/);
  assert.throws(()=>validateExplicitFixtureIds(["p3-99"]),/invalid_fixture_ids/);
});

test("campaign ID es obligatorio, namespaced y cerrado",()=>{
  assert.equal(SHADOW_QA_FINAL_CAMPAIGN_ID,"p3-v8-final-20260820");
  assert.equal(validateQaCampaignId(SHADOW_QA_FINAL_CAMPAIGN_ID),SHADOW_QA_FINAL_CAMPAIGN_ID);
  for(const invalid of [null,"","legacy","p3_bad","P3-v8","p3-v8/other"]) assert.throws(()=>validateQaCampaignId(invalid),/invalid_campaign_id/);
});

test("regresión 02 conserva contexto sintético pero tiene idempotencia independiente",()=>{
  const [historical,fresh]=SHADOW_AI_QA_REGRESSION_FIXTURES;
  assert.equal(historical.id,"p3-reg-payment-grounding-01");
  assert.equal(fresh.id,"p3-reg-payment-grounding-02");
  assert.equal(historical.metadata.contractId,fresh.metadata.contractId);
  assert.equal(historical.golden.expectedFixtureId,fresh.golden.expectedFixtureId);
  assert.equal(executionDisposition("completed"),"skip_completed");
  assert.equal(executionDisposition(undefined),"execute");
});

test("presupuesto reserva cierre de Function y difiere nuevos runs",()=>{
  assert.equal(SHADOW_QA_REQUEST_BUDGET_MS,118000);
  assert.equal(remainingRunBudget(0,0),110000);
  assert.ok(remainingRunBudget(0,100000)<SHADOW_QA_MIN_RUN_BUDGET_MS);
  assert.ok(remainingRunBudget(0,1000)>SHADOW_QA_MIN_RUN_BUDGET_MS);
});

test("agregación lee los 38 runs persistidos y reporta faltantes",()=>{
  const messages=SHADOW_AI_QA_DATASET.map((scenario,index)=>({id:`message-${index}`,provider_metadata:{syntheticScenario:scenario.id}}));
  const runs=SHADOW_AI_QA_DATASET.map((scenario,index)=>({id:`run-${index}`,message_id:`message-${index}`,status:"completed",model:"claude-haiku-4-5-20251001",prompt_version:"administradora-ia-emporio-v8",created_at:`2026-08-20T12:${String(index).padStart(2,"0")}:00Z`,latency_ms:100,input_tokens:10,output_tokens:5,estimated_cost_usd:.001,telemetry_json:{rounds:[{round:1}]}}));
  const decisions=SHADOW_AI_QA_DATASET.map((scenario,index)=>({ai_run_id:`run-${index}`,decision_json:{intent:scenario.golden.intent,requiresHuman:scenario.golden.requiresHuman,safetyFlags:[],proposedAction:"Revisar",proposedResponse:"Respuesta"},tool_summary:scenario.golden.requiredNowTools.map((name)=>({name,ok:true,resultCount:1}))}));
  const all=aggregatePersistedShadowQa({messages,runs,decisions}); assert.equal(all.results.length,38); assert.equal(all.completed,38); assert.deepEqual(all.missingFixtures,[]); assert.equal(all.metrics.count,38); assert.equal(all.metrics.averageRoundsPerRun,1);
  const missing=aggregatePersistedShadowQa({messages:messages.slice(1),runs:runs.slice(1),decisions:decisions.slice(1)}); assert.ok(missing.missingFixtures.includes("p3-01"));
});

test("agregación no mezcla legacy ni campañas distintas",()=>{
  const scenario=SHADOW_AI_QA_DATASET[0]; const message={id:"message-campaign",provider_metadata:{syntheticScenario:scenario.id}};
  const base={message_id:message.id,status:"completed",model:"claude-haiku-4-5-20251001",prompt_version:"administradora-ia-emporio-v8",created_at:"2026-08-20T12:00:00Z"};
  const runs=[{...base,id:"legacy",campaign_id:null},{...base,id:"campaign-a",campaign_id:"p3-campaign-a"},{...base,id:"campaign-b",campaign_id:"p3-campaign-b"}];
  const decisions=runs.map((run)=>({ai_run_id:run.id,decision_json:{intent:scenario.golden.intent},tool_summary:[]}));
  const aggregate=aggregatePersistedShadowQa({messages:[message],runs,decisions},{campaignId:"p3-campaign-a"});
  assert.equal(aggregate.results[0].runId,"campaign-a"); assert.equal(aggregate.campaignId,"p3-campaign-a");
  assert.equal(qaCampaignCompatibility(runs.slice(1,2)).compatible,true);
  assert.equal(qaCampaignCompatibility([{...runs[1],prompt_version:"otra-version"}]).compatible,false);
});

test("campaña final nueva inicia limpia con 38 pendientes",()=>{
  const messages=SHADOW_AI_QA_DATASET.map((scenario,index)=>({id:`message-clean-${index}`,provider_metadata:{syntheticScenario:scenario.id}}));
  const legacyRuns=messages.map((message,index)=>({id:`legacy-${index}`,message_id:message.id,status:"completed",model:"claude-haiku-4-5-20251001",prompt_version:"administradora-ia-emporio-v8",campaign_id:null}));
  const aggregate=aggregatePersistedShadowQa({messages,runs:legacyRuns,decisions:[]},{campaignId:SHADOW_QA_FINAL_CAMPAIGN_ID});
  assert.equal(aggregate.completed,0); assert.equal(aggregate.results.length,0); assert.equal(aggregate.missingFixtures.length,38);
});

test("métricas semánticas excluyen timeout y runs sin decision",()=>{
  const scenarios=SHADOW_AI_QA_DATASET.slice(0,2);
  const messages=scenarios.map((scenario,index)=>({id:`message-quality-${index}`,provider_metadata:{syntheticScenario:scenario.id}}));
  const runs=[
    {id:"run-timeout",message_id:messages[0].id,status:"timeout",model:"claude-haiku-4-5-20251001",prompt_version:"administradora-ia-emporio-v8",created_at:"2026-08-20T12:00:00Z",latency_ms:50080,telemetry_json:{rounds:[{round:1}]}},
    {id:"run-completed",message_id:messages[1].id,status:"completed",model:"claude-haiku-4-5-20251001",prompt_version:"administradora-ia-emporio-v8",created_at:"2026-08-20T12:01:00Z",latency_ms:44921,telemetry_json:{rounds:[{round:1}]}},
  ];
  const decisions=[{ai_run_id:"run-completed",decision_json:{intent:scenarios[1].golden.intent,requiresHuman:scenarios[1].golden.requiresHuman,safetyFlags:[],proposedAction:"Revisar",proposedResponse:"Respuesta"},tool_summary:[]}];
  const aggregate=aggregatePersistedShadowQa({messages,runs,decisions});
  assert.equal(aggregate.metrics.evaluatedDecisionCount,1);
  assert.equal(aggregate.metrics.intentAccuracy,1);
  assert.equal(aggregate.metrics.correctEscalationRate,1);
  assert.equal(aggregate.metrics.timeoutErrorRate,1/38);
});

test("ruta QA queda DEV-only, sintética, sin outbound ni write tools",()=>{
  const route=fs.readFileSync(new URL("../pages/api/operaciones/shadow-ai-qa.js",import.meta.url),"utf8");
  const context=fs.readFileSync(new URL("../lib/shadow/context.js",import.meta.url),"utf8");
  assert.match(route,/DEV_PROJECT_REF/); assert.match(route,/SHADOW_AI_ALLOW_REAL_MESSAGES!=="false"/); assert.match(route,/SHADOW_OUTBOUND_ENABLED!=="false"/);
  assert.match(route,/validateExplicitFixtureIds/); assert.match(route,/executionDisposition/); assert.match(route,/external_message_id/); assert.match(route,/maxDuration:\s*120/);
  assert.match(route,/retryFailed=req\.body\?\.retryFailed===true/); assert.match(route,/explicit_user_authorized/);
  assert.match(route,/validateQaCampaignId/); assert.match(route,/\.eq\("campaign_id",campaignId\)/); assert.match(route,/qaCampaignCompatibility/);
  assert.match(route,/shadow_ai_decisions/); assert.match(route,/attempt_number/);
  assert.doesNotMatch(route,/respond|whatsapp/i); assert.doesNotMatch(context,/\.(?:insert|update|upsert|delete)\s*\(/);
});

test("UI separa ejecución normal del retry fallido explícito",()=>{
  const page=fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js",import.meta.url),"utf8");
  assert.match(page,/Reintentar run fallido/); assert.match(page,/retryFailed:true/);
  assert.match(page,/Intento \{Number\(aiRun\.attempt_number\|\|1\)\} de 3/);
  assert.match(page,/retryFailed = false/);
});
