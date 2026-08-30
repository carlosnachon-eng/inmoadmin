import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { AUTO_REAL_MAX_IMMEDIATE_CONTINUATIONS, immediateContinuationGate } from "../lib/shadow/ai/autoReal.js";
import { nextRoundPlan } from "../lib/shadow/ai/stateMachine.js";
import { shadowAiOutputMode } from "../lib/shadow/ai/anthropic.js";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const deadlineAt = "2026-08-30T12:01:45.000Z";
const baseTurn = { turnKey:"turn-1", humanResponseId:null, closedReason:"settled", mediaSettlement:{status:"ready_or_terminal"} };

test("ronda con tool continúa inmediatamente dentro del mismo invocation y deadline", () => {
  const gate = immediateContinuationGate({ turn:baseTurn, expectedTurnKey:"turn-1", deadlineAt, now:Date.parse("2026-08-30T12:00:10Z"), minimumBudgetMs:42000 });
  assert.deepEqual(gate,{allowed:true,remainingBudgetMs:95000});
  const source=read("lib/shadow/ai/autoReal.js");
  assert.match(source,/continueAutoRealImmediately\(admin, started/);
  assert.match(source,/continueShadowAiStateMachine\(admin, result\.runId/);
});

test("presupuesto insuficiente falla cerrado sin iniciar otra ronda", () => {
  assert.deepEqual(immediateContinuationGate({ turn:baseTurn, expectedTurnKey:"turn-1", deadlineAt, now:Date.parse("2026-08-30T12:01:04Z"), minimumBudgetMs:42000 }),{allowed:false,reason:"insufficient_round_budget",timeout:true});
});

test("nuevo inbound entre rondas invalida turn key", () => {
  assert.deepEqual(immediateContinuationGate({ turn:{...baseTurn,turnKey:"turn-2"}, expectedTurnKey:"turn-1", deadlineAt, now:Date.parse("2026-08-30T12:00:10Z") }),{allowed:false,reason:"new_inbound_before_next_round"});
});

test("respuesta humana entre rondas cancela continuación", () => {
  assert.deepEqual(immediateContinuationGate({ turn:{...baseTurn,humanResponseId:"human-1",closedReason:"human_response"}, expectedTurnKey:"turn-1", deadlineAt, now:Date.parse("2026-08-30T12:00:10Z") }),{allowed:false,reason:"human_response_before_next_round"});
});

test("doble worker y terminación usan compare-and-set sobre awaiting_model_round", () => {
  const state=read("lib/shadow/ai/stateMachine.js");
  assert.match(state,/claimRun\(admin, runId, expectedState\)/);
  assert.match(state,/\.eq\("id", runId\)\.eq\("execution_state", expectedState\)/);
  assert.match(state,/\.eq\("id", runId\)\.eq\("execution_state", "awaiting_model_round"\)/);
});

test("tool duplicada queda bloqueada por idempotency key persistida", () => {
  const run={current_round:1,max_rounds:3};
  const call={name:"resolve_contact_identity",args:{respondContactId:"opaque"}};
  const first=nextRoundPlan(run,[call],[]);
  const duplicate=nextRoundPlan(run,[call],[{idempotencyKey:first.uniqueCalls[0].idempotencyKey}]);
  assert.equal(duplicate.uniqueCalls.length,0);
});

test("máximo de tres rondas se conserva", () => {
  assert.equal(AUTO_REAL_MAX_IMMEDIATE_CONTINUATIONS,2);
  assert.equal(nextRoundPlan({current_round:2,max_rounds:3},[],[]).canContinue,false);
});

test("conversation action sigue persistida una sola vez por la máquina final", () => {
  const state=read("lib/shadow/ai/stateMachine.js");
  assert.equal((state.match(/persistConversationAction\(admin/g)||[]).length,1);
});

test("telemetría inter-round contiene timestamps delay y presupuesto", () => {
  const state=read("lib/shadow/ai/stateMachine.js");
  for (const field of ["round_completed_at","next_round_started_at","inter_round_delay_ms","remaining_deadline_ms_at_round_start"]) assert.match(state,new RegExp(field));
});

test("text_json_local queda intacto y outbound/R1 no se habilitan", () => {
  assert.equal(shadowAiOutputMode({SHADOW_AI_OUTPUT_MODE:"text_json_local"}),"text_json_local");
  const auto=read("lib/shadow/ai/autoReal.js");
  assert.match(auto,/SHADOW_OUTBOUND_ENABLED: "false"/);
  assert.doesNotMatch(auto,/SHADOW_ADMIN_WORK_R1_ENABLED: "true"|SHADOW_ADMIN_OUTBOUND_ENABLED: "true"/);
});
