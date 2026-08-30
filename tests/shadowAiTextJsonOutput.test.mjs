import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAnthropicShadowResponse } from "../lib/shadow/ai/anthropic.js";
import { parseAndValidateShadowAiText, stripDeterministicJsonFence, validateWithSingleRepair } from "../lib/shadow/ai/textJsonOutput.js";
import { runShadowOutputAbFixture } from "../lib/shadow/ai/outputAbEvaluation.js";

const decision = {
  intent:"saludo",secondaryIntents:[],urgency:"low",summary:"Saludo administrativo.",entitiesMentioned:[],resolvedEntities:[],entityResolutionStatus:"not_applicable",informationNeeded:[],proposedToolCalls:[],contextAssessment:"Sin gestión requerida.",proposedAction:"Sin acción.",factualClaims:[],conversationalResponseParts:{acknowledgement:"Hola.",verifiedFactReferences:[],clarificationQuestion:null,escalationMessage:null},executionCommitment:"none",confidence:0.95,requiresHuman:false,escalationReason:null,safetyFlags:[],
};
const env={ANTHROPIC_API_KEY:"dev-only",SHADOW_AI_OUTPUT_MODE:"text_json_local"};

test("text_json_local omite output_config y conserva modelo/mensajes",async()=>{
  let body;
  await createAnthropicShadowResponse([{role:"system",content:"s"},{role:"user",content:"u"}],{env,fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return{ok:true,json:async()=>({id:"req",content:[{type:"text",text:JSON.stringify(decision)}],usage:{}})}}});
  assert.equal(body.model,"claude-haiku-4-5-20251001");
  assert.equal("output_config" in body,false);
  assert.equal(body.messages.length,1);
  assert.match(body.system,/servidor lo validará localmente/);
});

test("strip de fences es determinístico y no extrae JSON de prosa",()=>{
  assert.equal(stripDeterministicJsonFence(`\n\`\`\`json\n${JSON.stringify(decision)}\n\`\`\`\n`),JSON.stringify(decision));
  assert.throws(()=>parseAndValidateShadowAiText(`texto ${JSON.stringify(decision)}`),/json_parse_error/);
});

test("JSON válido y schema válido se aceptan localmente",()=>{
  const result=parseAndValidateShadowAiText(JSON.stringify(decision));
  assert.deepEqual(result.decision,decision);
  assert.deepEqual(result.telemetry,{parse_success:true,schema_success:true,repair_attempted:false,repair_success:false,invalid_output:false});
});

test("JSON inválido usa máximo un repair y nunca acepta antes de validar",async()=>{
  let calls=0;
  const result=await validateWithSingleRepair("{",{repair:async()=>{calls+=1;return{text:JSON.stringify(decision)}}});
  assert.equal(calls,1);assert.equal(result.telemetry.repair_attempted,true);assert.equal(result.telemetry.repair_success,true);assert.equal(result.telemetry.invalid_output,false);
});

test("schema inválido dos veces falla cerrado y no repite repair",async()=>{
  let calls=0;
  await assert.rejects(()=>validateWithSingleRepair(JSON.stringify({...decision,intent:"inventado"}),{repair:async()=>{calls+=1;return{text:JSON.stringify({...decision,intent:"todavia_invalido"})}}}),error=>{
    assert.equal(error.outputTelemetry.repair_attempted,true);assert.equal(error.outputTelemetry.repair_success,false);assert.equal(error.outputTelemetry.invalid_output,true);return true;
  });
  assert.equal(calls,1);
});

test("campos extra, enums y límites siguen usando el schema local como verdad",()=>{
  assert.throws(()=>parseAndValidateShadowAiText(JSON.stringify({...decision,extra:"no"})),/invalid_shape/);
  assert.throws(()=>parseAndValidateShadowAiText(JSON.stringify({...decision,summary:"x".repeat(501)})),/string_limit_exceeded/);
  assert.throws(()=>parseAndValidateShadowAiText(JSON.stringify({...decision,urgency:"urgent"})),/invalid_enum/);
});

test("A/B sintético compara semántica sin persistir outputs",async()=>{
  const bodies=[];
  const fetchImpl=async(_url,options)=>{bodies.push(JSON.parse(options.body));return{ok:true,headers:{get:()=>"req_fixture"},json:async()=>({id:`req_${bodies.length}`,model:"claude-haiku-4-5-20251001",content:[{type:"text",text:JSON.stringify(decision)}],usage:{input_tokens:100,output_tokens:20}})}};
  const result=await runShadowOutputAbFixture("maintenance-missing-location",{env,fetchImpl,timeoutMs:1000});
  assert.equal(bodies.length,2);assert.equal("output_config" in bodies[0],true);assert.equal("output_config" in bodies[1],false);
  assert.equal(result.structured.schema_success,true);assert.equal(result.text_json_local.schema_success,true);assert.equal(result.semantic_equivalence,true);
  assert.equal("output" in result,false);assert.equal(JSON.stringify(result).includes("Saludo administrativo"),false);
});

test("A/B registra repair separado y lo limita a una llamada",async()=>{
  let call=0;
  const fetchImpl=async()=>{call+=1;const text=call===1?JSON.stringify(decision):call===2?"{":JSON.stringify(decision);return{ok:true,headers:{get:()=>`req_${call}`},json:async()=>({id:`req_${call}`,content:[{type:"text",text}],usage:{input_tokens:10,output_tokens:2}})}};
  const result=await runShadowOutputAbFixture("payment-missing-period",{env,fetchImpl,timeoutMs:1000});
  assert.equal(call,3);assert.equal(result.text_json_local.repair_attempted,true);assert.equal(result.text_json_local.repair_success,true);assert.equal(result.text_json_local.repair_metrics.input_tokens,10);
});

test("endpoint A/B es DEV-only, admin/same-origin y exige todos los writes OFF",()=>{
  const source=fs.readFileSync(new URL("../pages/api/operaciones/shadow-ai-output-ab-eval.js",import.meta.url),"utf8");
  assert.match(source,/authorizeShadowAdministrator/);assert.match(source,/sameOriginAdminRequest/);
  assert.match(source,/SUPABASE_ENVIRONMENT==="dev"/);assert.match(source,/hjfwjnejbcpmknvfpdcq/);
  assert.match(source,/SHADOW_OUTBOUND_ENABLED==="true"/);assert.match(source,/SHADOW_ADMIN_OUTBOUND_ENABLED==="true"/);assert.match(source,/SHADOW_ADMIN_WORK_R1_ENABLED==="true"/);
  assert.doesNotMatch(source,/\.from\(|send|insert|update|upsert|delete/i);
});
