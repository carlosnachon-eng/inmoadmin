import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  EXPLICIT_RETRY_REASON, EXPLICIT_RETRY_RUNTIME, assertExplicitRetryEnvironment,
  evaluateExplicitRetryFacts, executeExplicitRetry,
} from "../lib/shadow/ai/explicitRetry.js";

const base = {
  parentFound:true, turnKeyPresent:true, parentRetryable:true, parentIsChild:false, childExists:false,
  newerRunExists:false, successfulRunAfter:false, turnCurrent:true, humanResponseAfter:false,
  outboundAfter:false, activeActionExists:false, newerInboundAfter:false, mediaSettled:true,
  identityDependencyPresent:true, identityResolved:true, operationalContextResolved:true,
};
const reason = (patch) => evaluateExplicitRetryFacts({ ...base, ...patch }).reason;

test("retry explícito: precondiciones fail-closed", () => {
  assert.equal(evaluateExplicitRetryFacts(base).eligible, true);
  assert.equal(reason({ identityResolved:false }), "identity_not_resolved");
  assert.equal(reason({ humanResponseAfter:true }), "human_response_after_parent");
  assert.equal(reason({ outboundAfter:true }), "outbound_after_parent");
  assert.equal(reason({ successfulRunAfter:true }), "successful_run_after_parent");
  assert.equal(reason({ childExists:true }), "authorized_retry_already_exists");
  assert.equal(reason({ parentRetryable:false }), "parent_not_retryable");
  assert.equal(reason({ newerInboundAfter:true }), "newer_inbound_after_turn");
  assert.equal(reason({ activeActionExists:true }), "active_conversation_action_exists");
});

test("capability exige entorno aislado, outbound OFF y R1 OFF", () => {
  const env={SHADOW_AI_EXPLICIT_RETRY_ENABLED:"true",SHADOW_OUTBOUND_ENABLED:"false",SHADOW_ADMIN_OUTBOUND_ENABLED:"false",SHADOW_ADMIN_WORK_R1_ENABLED:"false",SUPABASE_ENVIRONMENT:"dev",VERCEL_ENV:"preview"};
  assert.equal(assertExplicitRetryEnvironment(env).mode,"dev");
  assert.throws(()=>assertExplicitRetryEnvironment({...env,SHADOW_ADMIN_OUTBOUND_ENABLED:"true"}),/outbound/);
  assert.throws(()=>assertExplicitRetryEnvironment({...env,SHADOW_ADMIN_WORK_R1_ENABLED:"true"}),/r1/);
});

test("retry autorizado crea child con parent, turn, runtime y policy actual", async () => {
  const inserted=[]; let startOptions;
  const admin={from:(table)=>({insert:async(row)=>{inserted.push({table,row});return {data:row,error:null};}})};
  const parent={id:"11111111-1111-4111-8111-111111111111"};
  const turn={turnKey:"a".repeat(64),anchorMessageId:"22222222-2222-4222-8222-222222222222",messageIds:["22222222-2222-4222-8222-222222222222"],closedReason:"settled",mediaSettlement:{status:"ready_or_terminal"},sanitizedText:"Caso sanitizado",lastInboundAt:"2026-08-29T12:00:00.000Z",priorContextMessages:[],attachmentContext:{present:false,interpreted:false,items:[]}};
  const conversation={channel:"544519",respond_contact_id:"contact_opaque"};
  const inspectRetry=async()=>({eligible:true,reason:"eligible",parent,turnKey:turn.turnKey,turn,conversation,identity:{}});
  const startRun=async(_admin,_input,options)=>{startOptions=options;return {status:"completed",runId:"33333333-3333-4333-8333-333333333333"};};
  const env={SHADOW_AI_EXPLICIT_RETRY_ENABLED:"true",SHADOW_OUTBOUND_ENABLED:"false",SHADOW_ADMIN_OUTBOUND_ENABLED:"false",SHADOW_ADMIN_WORK_R1_ENABLED:"false",SUPABASE_ENVIRONMENT:"dev",VERCEL_ENV:"preview",SHADOW_IDENTITY_BRIDGE_ENABLED:"true"};
  const result=await executeExplicitRetry(admin,{parentRunId:parent.id,actorProfileId:"44444444-4444-4444-8444-444444444444",authorization:EXPLICIT_RETRY_REASON},{env,now:Date.parse("2026-08-29T13:00:00Z"),inspectRetry,startRun});
  assert.equal(result.status,"completed");
  assert.equal(startOptions.retryAuthorization,EXPLICIT_RETRY_REASON);
  assert.equal(startOptions.allowRetry,false);
  assert.equal(startOptions.inputMode,"auto_real_explicit_retry");
  assert.equal(startOptions.explicitRetryMetadata.parent_run_id,parent.id);
  assert.equal(startOptions.explicitRetryMetadata.retry_runtime_version,EXPLICIT_RETRY_RUNTIME);
  assert.equal(startOptions.explicitRetryMetadata.retry_turn_key,turn.turnKey);
  assert.equal(startOptions.env.SHADOW_OUTBOUND_ENABLED,"false");
  assert.equal(startOptions.env.SHADOW_ADMIN_WORK_R1_ENABLED,"false");
  assert.equal(inserted[0].table,"shadow_ai_explicit_retry_audit");
  assert.equal(inserted[0].row.parent_run_id,parent.id);
  assert.equal(inserted[0].row.child_run_id,result.runId);
});

test("sin autorización explícita no crea child", async () => {
  const env={SHADOW_AI_EXPLICIT_RETRY_ENABLED:"true",SHADOW_OUTBOUND_ENABLED:"false",SHADOW_ADMIN_OUTBOUND_ENABLED:"false",SHADOW_ADMIN_WORK_R1_ENABLED:"false",SUPABASE_ENVIRONMENT:"dev",VERCEL_ENV:"preview"};
  const result=await executeExplicitRetry({}, {parentRunId:"x",actorProfileId:"y",authorization:"no"},{env});
  assert.equal(result.reason,"explicit_authorization_required");
});

test("migración asegura idempotencia, auditoría append-only y parent inmutable", () => {
  const sql=fs.readFileSync(new URL("../supabase/migrations/202608290002_auto_real_explicit_retry.sql",import.meta.url),"utf8");
  const checks=fs.readFileSync(new URL("../supabase/migrations/202608290002_auto_real_explicit_retry_checks.sql",import.meta.url),"utf8");
  assert.match(sql,/unique index shadow_ai_runs_explicit_retry_once_uidx/);
  assert.match(sql,/retry_reason = 'explicit_user_authorized'/);
  assert.match(sql,/retry_of_run_id = parent_run_id/);
  assert.match(sql,/grant select, insert .* service_role/);
  assert.doesNotMatch(sql,/grant .*update.*shadow_ai_explicit_retry_audit/i);
  assert.match(checks,/audit must be append-only/);
});

test("endpoint es admin-only, same-origin y no usa QA", () => {
  const endpoint=fs.readFileSync(new URL("../pages/api/operaciones/shadow-ai-explicit-retry.js",import.meta.url),"utf8");
  assert.match(endpoint,/authorizeShadowAdministrator/);
  assert.match(endpoint,/sameOriginAdminRequest/);
  assert.doesNotMatch(endpoint,/shadow-ai-qa|qaOrchestrator/);
  assert.match(endpoint,/EXPLICIT_RETRY_REASON/);
});

test("child usa pipeline 3A/3B natural y R1 permanece gobernado por flag OFF", () => {
  const machine=fs.readFileSync(new URL("../lib/shadow/ai/stateMachine.js",import.meta.url),"utf8");
  assert.match(machine,/\["auto_real_shadow", "auto_real_explicit_retry"\]/);
  assert.match(machine,/persistConversationAction/);
  assert.match(machine,/maybeExecuteAdministrativeWorkR1/);
  const retry=fs.readFileSync(new URL("../lib/shadow/ai/explicitRetry.js",import.meta.url),"utf8");
  assert.match(retry,/SHADOW_ADMIN_WORK_R1_ENABLED: "false"/);
  assert.match(retry,/SHADOW_OUTBOUND_ENABLED: "false"/);
});
