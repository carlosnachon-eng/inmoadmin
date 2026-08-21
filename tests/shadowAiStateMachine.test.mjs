import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { continuationDisposition, nextRoundPlan, SHADOW_AI_RUN_STATES } from "../lib/shadow/ai/stateMachine.js";

test("state machine exposes auditable terminal and intermediate states",()=>{
  assert.deepEqual(SHADOW_AI_RUN_STATES,["created","model_round_running","awaiting_tool_execution","awaiting_model_round","completed","blocked","error","timeout"]);
});
test("continuation accepts only awaiting_model_round",()=>{
  assert.equal(continuationDisposition({execution_state:"awaiting_model_round"}),"claim");
  for(const state of ["completed","blocked","error","timeout"])assert.equal(continuationDisposition({execution_state:state}),`blocked_${state}`);
});
test("concurrent/running continuation is rejected",()=>{
  assert.equal(continuationDisposition({execution_state:"model_round_running"}),"already_running");
  assert.equal(continuationDisposition({execution_state:"awaiting_tool_execution"}),"already_running");
});
test("tool executions are idempotent by run round tool and arguments",()=>{
  const run={current_round:0,max_rounds:3};const calls=[{name:"get_payment_summary",args:{paymentId:"a"}},{name:"get_payment_summary",args:{paymentId:"b"}}];
  const first=nextRoundPlan(run,calls,[]);assert.equal(first.uniqueCalls.length,2);
  const second=nextRoundPlan(run,calls,[{idempotencyKey:first.uniqueCalls[0].idempotencyKey}]);assert.deepEqual(second.uniqueCalls.map(x=>x.args.paymentId),["b"]);
});
test("a completed round advances deterministically and stops at max three",()=>{
  assert.deepEqual(nextRoundPlan({current_round:0,max_rounds:3},[],[]),{round:1,uniqueCalls:[],canContinue:true});
  assert.equal(nextRoundPlan({current_round:2,max_rounds:3},[],[]).canContinue,false);
});
test("continuation endpoint is DEV-only, explicit and one provider call per request",()=>{
  const endpoint=fs.readFileSync(new URL("../pages/api/operaciones/shadow-ai-continue.js",import.meta.url),"utf8");
  const core=fs.readFileSync(new URL("../lib/shadow/ai/stateMachine.js",import.meta.url),"utf8");
  assert.match(endpoint,/DEV_PROJECT_REF/);assert.match(endpoint,/SHADOW_AI_ALLOW_REAL_MESSAGES/);assert.match(endpoint,/SHADOW_OUTBOUND_ENABLED/);assert.match(endpoint,/runId/);
  assert.match(endpoint,/validateQaCampaignId/);assert.match(endpoint,/owned\.campaign_id !== campaignId/);
  assert.equal((core.match(/createAnthropicShadowResponse\)\(/g)||[]).length,1);
});
test("start persists awaiting instead of insufficient-round timeout",()=>{
  const core=fs.readFileSync(new URL("../lib/shadow/ai/stateMachine.js",import.meta.url),"utf8");
  assert.match(core,/execution_state: "awaiting_model_round"/);assert.doesNotMatch(core,/insufficient_round_budget/);
  assert.match(core,/deriveRequiredTools/); assert.match(core,/combinePolicyAndModelTools/);
  assert.match(core,/policy_required_tools/); assert.match(core,/source/);
});
test("state persistence excludes raw provider output and chain of thought",()=>{
  const core=fs.readFileSync(new URL("../lib/shadow/ai/stateMachine.js",import.meta.url),"utf8");
  assert.doesNotMatch(core,/raw_response|chain_of_thought|modelResult\.text[^)]*roundState/);
  assert.match(core,/round_state_json/);assert.match(core,/evidence_ledger/);assert.match(core,/tool_results_json/);
});
test("timeout stages remain distinct and fail closed",()=>{
  const core=fs.readFileSync(new URL("../lib/shadow/ai/stateMachine.js",import.meta.url),"utf8");
  assert.match(core,/anthropic_request_timeout/);assert.match(core,/tool_timeout/);assert.match(core,/request_budget_exhausted/);assert.match(core,/responseBlocked: true/);
});
test("safety limits keep read-only tools, three rounds, no automatic continuation",()=>{
  const core=fs.readFileSync(new URL("../lib/shadow/ai/stateMachine.js",import.meta.url),"utf8");
  assert.match(core,/READ_ONLY_SHADOW_TOOLS/);assert.match(core,/maxToolRounds/);assert.match(core,/maxToolsPerRound/);assert.doesNotMatch(core,/setInterval|cron|queue/);
});
test("migration preserves RLS, strict grants and JSON checks",()=>{
  const sql=fs.readFileSync(new URL("../supabase/dev/bootstrap/202608200004_fase_2a_p3_ai_state_machine.sql",import.meta.url),"utf8");
  const checks=fs.readFileSync(new URL("../supabase/dev/tests/202608200004_fase_2a_p3_ai_state_machine_tests.sql",import.meta.url),"utf8");
  assert.match(sql,/DEV only/);assert.match(sql,/enable row level security/);assert.match(sql,/revoke all .* anon/);assert.match(sql,/grant all .* service_role/);
  assert.match(checks,/anon has unsafe grants/);assert.match(checks,/open policy found/);
});
test("UI exposes explicit continuation and persisted evidence",()=>{
  const ui=fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js",import.meta.url),"utf8");
  assert.match(ui,/Esperando siguiente ronda/);assert.match(ui,/Continuar run/);assert.match(ui,/evidence_ledger/);assert.match(ui,/shadow-ai-continue/);assert.match(ui,/campaignId: qaCampaignId/);
});
