import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { classifyAnthropicFailure } from "../lib/shadow/ai/anthropic.js";
import { SHADOW_AI_LIMITS } from "../lib/shadow/ai/guards.js";
import { executeAnthropicAttemptPolicy } from "../lib/shadow/ai/stateMachine.js";
import { buildRealShadowConversationTurns, realShadowTurnEnvelope } from "../lib/shadow/ai/conversationTurns.js";

const clock = { now: () => Date.now(), setTimeout, clearTimeout };
const telemetry = () => ({ anthropic_requests: [] });
const ok = { id:"req_ok", text:"{}", usage:{ input_tokens:10, output_tokens:2 } };
const abort = () => Object.assign(new Error("provider prose must not persist"), { name:"AbortError" });

test("primer timeout sin respuesta recibe un único retry y el segundo intento puede completar", async () => {
  let calls=0; const t=telemetry();
  const result=await executeAnthropicAttemptPolicy({ call:async()=>{calls++;if(calls===1)throw abort();return ok;},clock,deadlineMs:Date.now()+100000,attemptTimeoutMs:40000,minimumRetryBudgetMs:42000,round:1,telemetry:t });
  assert.equal(calls,2);assert.equal(result.result.id,"req_ok");assert.equal(t.anthropic_requests.length,2);assert.equal(t.anthropic_requests[0].timeout_class,"headers_first_byte_timeout");
  assert.equal(t.anthropic_requests[1].usage.input_tokens,10);
});

test("timeout sin presupuesto no reintenta y falla como deadline local", async () => {
  let calls=0; const t=telemetry();
  await assert.rejects(()=>executeAnthropicAttemptPolicy({call:async()=>{calls++;throw abort();},clock,deadlineMs:Date.now()+1000,attemptTimeoutMs:40000,minimumRetryBudgetMs:42000,round:1,telemetry:t}),/provider prose/);
  assert.equal(calls,1);assert.equal(t.anthropic_requests[0].remaining_deadline_ms<42000,true);
});

test("dos timeouts terminan tras exactamente dos intentos e idempotencia limita retry global", async () => {
  let calls=0; const t=telemetry();
  await assert.rejects(()=>executeAnthropicAttemptPolicy({call:async()=>{calls++;throw abort();},clock,deadlineMs:Date.now()+100000,attemptTimeoutMs:40000,minimumRetryBudgetMs:42000,round:1,telemetry:t}),/provider prose/);
  assert.equal(calls,2);assert.equal(t.anthropic_requests.length,2);
  let later=0;
  await assert.rejects(()=>executeAnthropicAttemptPolicy({call:async()=>{later++;throw abort();},clock,deadlineMs:Date.now()+100000,attemptTimeoutMs:40000,minimumRetryBudgetMs:42000,priorRetryCount:1,round:2,telemetry:t}),/provider prose/);
  assert.equal(later,1);
});

test("429 y 5xx quedan diferenciados y no se reintentan", async () => {
  assert.equal(classifyAnthropicFailure({providerError:{provider_status:429}}),"provider_rate_limited");
  assert.equal(classifyAnthropicFailure({providerError:{provider_status:503}}),"provider_5xx");
  for(const status of [429,503]){let calls=0;await assert.rejects(()=>executeAnthropicAttemptPolicy({call:async()=>{calls++;throw Object.assign(new Error("http"),{providerError:{provider_status:status}})},clock,deadlineMs:Date.now()+100000,attemptTimeoutMs:40000,minimumRetryBudgetMs:42000,round:1,telemetry:telemetry()}));assert.equal(calls,1);}
});

test("clasifica connect, headers y body sin persistir mensajes",()=>{
  assert.equal(classifyAnthropicFailure({code:"UND_ERR_CONNECT_TIMEOUT"}),"connection_timeout");
  assert.equal(classifyAnthropicFailure({code:"UND_ERR_HEADERS_TIMEOUT"}),"headers_first_byte_timeout");
  assert.equal(classifyAnthropicFailure({code:"UND_ERR_BODY_TIMEOUT"}),"body_response_timeout");
});

const conversation={id:"c",provider:"respond_admin",channel:"544519"};
const image=(at)=>({id:"m",conversation_id:"c",direction:"inbound",occurred_at:at,sanitized_text:"[IMAGEN]",external_message_id:"ext",provider_metadata:{},attachment_metadata:[{type:"image",mimeType:"image/jpeg"}]});
test("settlement multimedia espera imagen permitida y usa interpretación que llega antes del cutoff",()=>{
  const messages=[image("2026-08-29T10:00:00Z")];
  const waiting=buildRealShadowConversationTurns({messages,conversations:[conversation],now:Date.parse("2026-08-29T10:03:00Z")})[0];
  assert.equal(waiting.mediaSettlement.status,"waiting");
  const completed=buildRealShadowConversationTurns({messages,conversations:[conversation],mediaRetrievals:[{external_message_id:"ext",status:"completed"}],mediaInterpretations:[{external_message_id:"ext",status:"completed",result_safe:{interpretation_status:"completed",category:"property_photo",summary:"Foto",extracted_fields:{}}}],now:Date.parse("2026-08-29T10:06:00Z")})[0];
  assert.equal(completed.mediaSettlement.status,"ready_or_terminal");assert.equal(completed.mediaSettlement.interpreted_count,1);
});

test("interpretación tardía no entra al snapshot y audio/video no prolongan settlement",()=>{
  const late=buildRealShadowConversationTurns({messages:[image("2026-08-29T10:00:00Z")],conversations:[conversation],now:Date.parse("2026-08-29T10:09:00Z")})[0];
  assert.equal(late.mediaSettlement.status,"deadline_reached_with_pending");assert.equal(late.mediaSettlement.not_used_count,1);
  const envelope=realShadowTurnEnvelope(late,conversation);assert.equal(envelope.providerMetadata.attachmentContext.interpreted,false);assert.doesNotMatch(JSON.stringify(envelope.providerMetadata.attachmentContext),/sourceMessageId|ext/);
  const audio={...image("2026-08-29T10:00:00Z"),attachment_metadata:[{type:"audio",mimeType:"audio/ogg"}]};
  assert.equal(buildRealShadowConversationTurns({messages:[audio],conversations:[conversation],now:Date.parse("2026-08-29T10:03:00Z")})[0].mediaSettlement.status,"ready_or_terminal");
});

test("artefactos exigen deadline durable, no backfill, y R1/sender dependen de run completo",()=>{
  const migration=fs.readFileSync(new URL("../supabase/migrations/202608290001_auto_real_timeout_resilience.sql",import.meta.url),"utf8");
  const state=fs.readFileSync(new URL("../lib/shadow/ai/stateMachine.js",import.meta.url),"utf8");
  assert.match(migration,/deadline_at timestamptz/);assert.doesNotMatch(migration,/update public\.shadow_ai_runs set deadline_at/i);
  assert.match(state,/durableRunDeadline\(run\)/);assert.match(state,/persistConversationAction/);assert.match(state,/maybeExecuteAdministrativeWorkR1/);
  assert.equal(SHADOW_AI_LIMITS.autoRealAnthropicAttemptTimeoutMs,40000);assert.equal(SHADOW_AI_LIMITS.autoRealDurableDeadlineMs,105000);
});
