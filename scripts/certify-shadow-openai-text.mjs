// No credentials, .env, real provider or Respond. Caller supplies an isolated
// PostgreSQL executor (local or explicitly pinned Supabase DEV MCP bridge).
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { textSqlDatabase, literal } from "../tests/helpers/openaiTextSql.mjs";
import { textEnv, textDecision, syntheticOpenAi } from "../tests/helpers/openaiTextFixture.mjs";
import { startShadowAiStateMachine, continueShadowAiStateMachine } from "../lib/shadow/ai/stateMachine.js";
import { loadAutoRealTurns, processNextAutoRealTurn } from "../lib/shadow/ai/autoReal.js";
import { inspectExplicitRetry } from "../lib/shadow/ai/explicitRetry.js";
import { OPENAI_TEXT_RUNTIME } from "../lib/shadow/ai/openaiTextRuntime.js";
import { REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AUTO_AI_PROMPT_VERSION } from "../lib/shadow/ai/realPrompt.js";

export async function certifyShadowOpenAiText(query,{environment,withIdentity=true,emit=()=>{}}={}){
  assert.ok(["local_postgresql","hjfwjnejbcpmknvfpdcq"].includes(environment));
  const inventory={conversations:[],messages:[],contact:`openai-text-dev-${randomUUID()}`},checks=[];
  const check=(name,condition)=>{assert.ok(condition,name);checks.push({name,status:"PASS"});emit(checks.at(-1));};
  const db=textSqlDatabase(query,inventory);let providerCalls=0,cleanup=false,forbiddenNetworkAttempts=0;
  const qid=ids=>ids.map(literal).join(",")||"null";
  const row=async(table,field,id)=>(await query(`select * from public.${table} where ${field}=${literal(id)}`))[0];
  const fixture=async()=>{
    const c=randomUUID(),m=randomUUID(),occurred=new Date(Date.now()-600000).toISOString(),hash=createHash("sha256").update(m).digest("hex");
    inventory.conversations.push(c);inventory.messages.push(m);
    await query(`insert into public.shadow_conversations(id,provider,external_conversation_id,contact_hash,channel,first_message_at,last_message_at,respond_contact_id) values (${literal(c)},'respond_admin',${literal(`openai-text-dev-${c}`)},${literal(hash)},'544519',${literal(occurred)},${literal(occurred)},${withIdentity?literal(inventory.contact):"null"});
      insert into public.shadow_messages(id,conversation_id,provider,external_message_id,direction,occurred_at,sanitized_text,content_hash) values (${literal(m)},${literal(c)},'respond_admin',${literal(m)},'inbound',${literal(occurred)},'Necesito información sobre mantenimiento',${literal(hash)});`);
    const turnKey=createHash("sha256").update(`${c}:${m}`).digest("hex");
    return {messageId:m,envelope:{provider:"respond_admin",direction:"inbound",sanitizedText:"Necesito información sobre mantenimiento",occurredAt:occurred,
      providerMetadata:{channelId:"544519",...(withIdentity?{respondContactId:inventory.contact}:{})}},
      options:{env:{...textEnv,SHADOW_AI_DURABLE_DEADLINE_MS:"600000",...(environment==="hjfwjnejbcpmknvfpdcq"?{SHADOW_AI_TOOL_TIMEOUT_MS:"60000"}:{})},textRuntime:OPENAI_TEXT_RUNTIME,inputMode:"auto_real_shadow",persistInputSnapshot:true,
        promptVersion:REAL_SHADOW_AUTO_AI_PROMPT_VERSION,systemPrompt:REAL_SHADOW_AI_SYSTEM_PROMPT,turnMetadata:{turnKey,messageIds:[m]}}};
  };
  const execute=async(f,p)=>{
    let r=await startShadowAiStateMachine(db,f,{...f.options,fetchImpl:p.fetchImpl});
    for(let i=0;i<2&&r.status==="awaiting_model_round";i++)r=await continueShadowAiStateMachine(db,r.runId,{...f.options,fetchImpl:p.fetchImpl});
    providerCalls+=p.sessions.length;return r;
  };
  const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{forbiddenNetworkAttempts++;throw Error("real_network_forbidden");};
  try{
    const constraints=await query("select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.shadow_conversation_actions'::regclass and conname='shadow_conversation_actions_check2'");
    check("real_check2_present",constraints.length===1&&constraints[0].definition.includes("auto_send_eligible"));
    const happy=await fixture(),p=syntheticOpenAi(),r=await execute(happy,p);
    check("completed_and_full_3a_3b_readback",["completed","blocked"].includes(r.status)&&r.telemetry.persistence.verified);
    const run=await row("shadow_ai_runs","id",r.runId),decision=await row("shadow_ai_decisions","ai_run_id",r.runId),action=await row("shadow_conversation_actions","ai_run_id",r.runId);
    check("decision_3a_action_same_run",!!decision.decision_json.operational_resolution&&action.turn_key===happy.options.turnMetadata.turnKey);
    check("usage_cost_persisted",run.input_tokens===p.sessions.length*100&&run.output_tokens===p.sessions.length*30&&Number(run.estimated_cost_usd)>0);
    check("all_receipts_pass",run.telemetry_json.model_requests.every(x=>x.receipt.final_payload_verified&&x.receipt.serialized_body_verified&&x.receipt.provider_invoked));
    if(withIdentity)check("real_identity_tool_read_only",run.telemetry_json.tools.some(t=>t.name==="resolve_contact_identity"&&t.succeeded)&&db.operations.filter(x=>x.operation!=="select").every(x=>["shadow_ai_runs","shadow_ai_decisions","shadow_conversation_actions"].includes(x.table)));
    for(const status of ["completed","error","timeout"]){
      const f=await fixture(),id=randomUUID();
      await query(`insert into public.shadow_ai_runs(id,message_id,status,execution_state,model,prompt_version,telemetry_json) values (${literal(id)},${literal(f.messageId)},${literal(status)},${literal(status)},'claude-haiku-4-5-20251001','historical-synthetic',${literal({turn_key:f.options.turnMetadata.turnKey})});`);
      const before=JSON.stringify(await row("shadow_ai_runs","id",id)),model=syntheticOpenAi();
      await execute(f,model);const loaded=await loadAutoRealTurns(db,{env:textEnv});
      check(`historical_${status}_not_pending_unchanged`,model.sessions.length===0&&JSON.stringify(await row("shadow_ai_runs","id",id))===before&&loaded.turns.find(t=>t.anchorMessageId===f.messageId)?.disposition!=="pending");
    }
    for(const mode of ["timeout","uncertain_create","http","invalid_output","privacy_failure","3b_failure"]){
      const f=await fixture(),model=syntheticOpenAi({mode,decision:mode==="invalid_output"?"not json":mode==="privacy_failure"?{...textDecision(),summary:"ref_inventado_1"}:textDecision()});
      // DEV's read-only identity preload crosses the MCP SQL bridge. The outer
      // model-stage deadline includes it; do not mistake bridge latency for a
      // provider timeout. The local harness separately certifies a 20 ms clock.
      f.options.env.SHADOW_AI_MODEL_TIMEOUT_MS=environment==="local_postgresql"?"20":"40000";
      f.options.env.SHADOW_AI_DURABLE_DEADLINE_MS="600000";
      if(mode==="3b_failure")db.failTable="shadow_conversation_actions";
      const result=await execute(f,model);db.failTable=null;
      check(`${mode}_explicit_fail_closed`,["error","timeout"].includes(result.status)&&result.telemetry.persistence.verified===false);
      const stored=await row("shadow_ai_runs","id",result.runId);
      check(`${mode}_receipt_durable`,stored.telemetry_json.model_requests.every(x=>x.receipt.final_payload_verified&&x.receipt.serialized_body_verified&&x.receipt.provider_invoked));
      check(`${mode}_no_3b`,!(await row("shadow_conversation_actions","ai_run_id",result.runId)));
      if(mode==="timeout"||mode==="uncertain_create"){
        check(`${mode}_usage_unknown_null`,stored.input_tokens===null&&stored.output_tokens===null);
        const again=syntheticOpenAi();await execute(f,again);
        check(`${mode}_permanent_reservation_no_retry`,again.sessions.length===0&&(await inspectExplicitRetry(db,result.runId)).reason==="openai_text_retry_not_authorized");
      }
    }
    const concurrent=await fixture(),provider=syntheticOpenAi();
    const results=await Promise.all([startShadowAiStateMachine(db,concurrent,{...concurrent.options,fetchImpl:provider.fetchImpl}),startShadowAiStateMachine(db,concurrent,{...concurrent.options,fetchImpl:provider.fetchImpl})]);
    check("concurrent_one_run_one_session",provider.sessions.length===1&&(await query(`select id from public.shadow_ai_runs where message_id=${literal(concurrent.messageId)}`)).length===1);
    const running=results.find(x=>x.status==="awaiting_model_round");
    if(running)await continueShadowAiStateMachine(db,running.runId,{...concurrent.options,fetchImpl:provider.fetchImpl});
    providerCalls+=provider.sessions.length;
    const cron=await fixture(),cronProvider=syntheticOpenAi();
    const cronOptions={env:{...cron.options.env},fetchImpl:cronProvider.fetchImpl,reconcileOrigins:async()=>{}};
    const first=await processNextAutoRealTurn(db,cronOptions),second=await processNextAutoRealTurn(db,cronOptions);
    check("cron_completed_then_idle",["completed","blocked"].includes(first.status)&&second.status==="idle");
    providerCalls+=cronProvider.sessions.length;
    check("zero_provider_or_outbound_network",forbiddenNetworkAttempts===0);
  } finally {
    globalThis.fetch=oldFetch;
    // Explicit fixture IDs only; no broad/global cleanup and no historical data.
    await query(`begin; delete from public.shadow_conversation_actions where ai_run_id in (select id from public.shadow_ai_runs where message_id in (${qid(inventory.messages)}));
      delete from public.shadow_ai_decisions where ai_run_id in (select id from public.shadow_ai_runs where message_id in (${qid(inventory.messages)}));
      delete from public.shadow_ai_runs where message_id in (${qid(inventory.messages)});
      delete from public.shadow_messages where id in (${qid(inventory.messages)});
      delete from public.shadow_conversations where id in (${qid(inventory.conversations)}); commit;`);
    const residues=await query(`select (select count(*) from public.shadow_conversations where id in (${qid(inventory.conversations)}))+(select count(*) from public.shadow_messages where id in (${qid(inventory.messages)}))+(select count(*) from public.shadow_ai_runs where message_id in (${qid(inventory.messages)})) residues`);
    cleanup=Number(residues[0].residues)===0;check("fixture_cleanup_zero_residues",cleanup);
    if(withIdentity){const audit=await query(`select count(*) n from public.respond_identity_audit where respond_contact_id=${literal(inventory.contact)}`);check("zero_identity_audit_rows",Number(audit[0].n)===0);}
  }
  return {environment,status:"PASS",checks,fixtures:{conversations:inventory.conversations.length,messages:inventory.messages.length,cleanup,residues:0},syntheticSessionCount:providerCalls,realProviderCalls:0};
}
