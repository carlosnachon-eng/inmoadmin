import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { shadowAiGuard, SHADOW_AI_LIMITS } from "../lib/shadow/ai/guards.js";
import { validateShadowAiDecision } from "../lib/shadow/ai/schema.js";
import { SHADOW_AI_QA_DATASET, evaluateShadowAiQa } from "../lib/shadow/ai/qaDataset.js";
import { READ_ONLY_SHADOW_TOOLS, SHADOW_TOOL_ARGUMENT_SCHEMAS } from "../lib/shadow/context.js";
import { runShadowAi } from "../lib/shadow/ai/runner.js";

const devEnv = { SHADOW_AI_ENABLED:"true", SHADOW_AI_ALLOW_REAL_MESSAGES:"false", SHADOW_OUTBOUND_ENABLED:"false", SUPABASE_ENVIRONMENT:"dev", NEXT_PUBLIC_SUPABASE_URL:"https://hjfwjnejbcpmknvfpdcq.supabase.co", ANTHROPIC_API_KEY:"fixture" };
const synthetic = { provider:"synthetic", providerMetadata:{syntheticScenario:"p3-01"} };
const validDecision={intent:"mantenimiento",secondaryIntents:[],urgency:"normal",summary:"Fuga",entitiesMentioned:[],informationNeeded:[],proposedToolCalls:[],contextAssessment:"Sin contexto",proposedAction:"Escalar",proposedResponse:"Lo revisará el equipo.",confidence:.8,requiresHuman:true,escalationReason:"Revisión",safetyFlags:[]};
function fakeAiDb(existing=null){
  const writes=[];
  return {writes,from(table){let action="select",payload;
    const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:existing,error:null}),insert(value){action="insert";payload=value;writes.push({table,action,payload});return q;},update(value){action="update";payload=value;writes.push({table,action,payload});return q;},single:async()=>({data:{id:"run-1"},error:null}),then(resolve){resolve({data:null,error:null});}}; return q;
  }};
}

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
});

test("tool layer es cerrado, read-only y limitado", () => {
  assert.equal(READ_ONLY_SHADOW_TOOLS.length,10); assert.equal(SHADOW_AI_LIMITS.maxToolRounds,3);
  assert.equal(Object.keys(SHADOW_TOOL_ARGUMENT_SCHEMAS).length,10);
  const context=fs.readFileSync(new URL("../lib/shadow/context.js",import.meta.url),"utf8");
  assert.doesNotMatch(context,/\.(?:insert|update|upsert|delete)\s*\(/);
  assert.doesNotMatch(context,/rpc\s*\(/); assert.match(context,/MAX_RESULTS = 5/);
});

test("dataset tiene 38 goldens y cubre safety", () => {
  assert.equal(SHADOW_AI_QA_DATASET.length,38);
  for(const row of SHADOW_AI_QA_DATASET){assert.ok(row.golden.intent);assert.equal(typeof row.golden.requiresHuman,"boolean");}
  for(const phrase of ["Descuéntame $5,000","Devuélveme mi depósito hoy","Cancela mi contrato","Dile al dueño que ya pagamos","Corta el agua","Entrégale las llaves al técnico","demandarlos","otro inquilino"]) assert.ok(SHADOW_AI_QA_DATASET.some(x=>x.text.includes(phrase)));
});

test("métricas no colapsan seguridad en un promedio",()=>{
  const one=SHADOW_AI_QA_DATASET.slice(0,1); const metrics=evaluateShadowAiQa(one,[{fixtureId:one[0].id,decision:{intent:one[0].golden.intent,requiresHuman:one[0].golden.requiresHuman,safetyFlags:[]},tools:[]}]);
  assert.deepEqual(Object.keys(metrics).sort(),["correctEscalationRate","count","hallucinationRate","intentAccuracy","unnecessaryToolRate","unsafeRecommendationRate"].sort());
});

test("privacidad y ausencia de capacidad outbound",()=>{
  const files=["../lib/shadow/ai/runner.js","../lib/shadow/ai/guards.js","../lib/shadow/ai/anthropic.js","../pages/api/operaciones/shadow-ai-run.js"].map(x=>fs.readFileSync(new URL(x,import.meta.url),"utf8")).join("\n");
  assert.doesNotMatch(files,/RESPOND_IO_TOKEN|RESPOND_CHANNEL_ROUTER|sendMessage|message\.send/);
  assert.doesNotMatch(files,/from\(["'](?:payments|contracts|cash_movements)["']\)\.(?:insert|update|upsert|delete)/);
  assert.match(files,/SHADOW_OUTBOUND_ENABLED/);
});

test("migración DEV conserva RLS y no abre anon",()=>{
  const sql=fs.readFileSync(new URL("../supabase/dev/bootstrap/202608200001_fase_2a_p3_ai_shadow.sql",import.meta.url),"utf8");
  assert.match(sql,/DEV only/); assert.match(sql,/enable row level security/); assert.match(sql,/revoke all .* anon/);
  assert.doesNotMatch(sql,/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
});

test("runner persiste decisión estructurada e idempotencia evita segunda llamada",async()=>{
  const db=fakeAiDb(); let calls=0;
  const result=await runShadowAi(db,{messageId:"message-1",envelope:{...synthetic,sanitizedText:"Sigue la fuga"},deterministic:{}},{env:devEnv,modelCall:async()=>{calls++;return{text:JSON.stringify(validDecision),usage:{input_tokens:100,output_tokens:50}};}});
  assert.equal(result.status,"completed"); assert.equal(calls,1);
  assert.ok(db.writes.some(x=>x.table==="shadow_ai_decisions")); assert.ok(db.writes.some(x=>x.payload?.estimated_cost_usd>0));
  const duplicate=await runShadowAi(fakeAiDb({id:"existing",status:"completed"}),{messageId:"message-1",envelope:{...synthetic,sanitizedText:"Sigue la fuga"},deterministic:{}},{env:devEnv,modelCall:async()=>{throw new Error("must_not_run");}});
  assert.equal(duplicate.status,"duplicate");
});

test("runner contiene salida malformada y timeout",async()=>{
  const malformed=await runShadowAi(fakeAiDb(),{messageId:"bad",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:devEnv,modelCall:async()=>({text:"no-json",usage:{}})});
  assert.equal(malformed.status,"error"); assert.equal(malformed.error.includes("QA"),false);
  const timeout=await runShadowAi(fakeAiDb(),{messageId:"slow",envelope:{...synthetic,sanitizedText:"QA"},deterministic:{}},{env:{...devEnv,SHADOW_AI_TIMEOUT_MS:"1"},modelCall:(_, {signal})=>new Promise((_,reject)=>signal.addEventListener("abort",()=>{const e=new Error("timeout");e.name="AbortError";reject(e);} ))});
  assert.equal(timeout.status,"timeout");
});

test("integración documental Anthropic existente permanece intacta",()=>{
  const source=fs.readFileSync(new URL("../pages/api/analizar-solicitud.js",import.meta.url),"utf8");
  assert.match(source,/claude-haiku-4-5-20251001/); assert.match(source,/ANTHROPIC_API_KEY/);
});
