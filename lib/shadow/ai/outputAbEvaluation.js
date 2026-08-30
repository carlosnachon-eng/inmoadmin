import { createAnthropicShadowRepairResponse, createAnthropicShadowResponse } from "./anthropic.js";
import { REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "./realPrompt.js";
import { parseAndValidateShadowAiText, validateWithSingleRepair } from "./textJsonOutput.js";

export const SHADOW_OUTPUT_AB_FIXTURES = Object.freeze({
  "maintenance-missing-location": { message:"Hay humedad desde ayer, pero todavía no indico en qué zona del departamento.", metadata:{domain:"maintenance",identityStatus:"confirmed",propertyContext:"resolved"} },
  "payment-missing-period": { message:"Adjunto un posible comprobante, pero no indiqué a qué periodo corresponde.", metadata:{domain:"payment",identityStatus:"confirmed",propertyContext:"resolved",attachmentInterpretation:"possible_payment_receipt"} },
  "administrative-pending-document": { message:"Quiero continuar mi trámite administrativo; todavía falta identificar el documento requerido.", metadata:{domain:"administrative_pending",identityStatus:"confirmed",propertyContext:"resolved"} },
});

const costUsd = (usage={}) => (Number(usage.input_tokens||0)+Number(usage.output_tokens||0)*5)/1_000_000;
const semanticProjection = (decision) => ({ intent:decision.intent,secondaryIntents:decision.secondaryIntents,urgency:decision.urgency,entityResolutionStatus:decision.entityResolutionStatus,informationNeeded:decision.informationNeeded,proposedTools:decision.proposedToolCalls.map((item)=>item.tool),executionCommitment:decision.executionCommitment,requiresHuman:decision.requiresHuman,safetyFlags:decision.safetyFlags });
export const semanticallyEquivalentShadowDecision = (left,right) => JSON.stringify(semanticProjection(left))===JSON.stringify(semanticProjection(right));
export const equivalentShadowDecisionProjections = (left,right) => JSON.stringify(left)===JSON.stringify(right);

async function providerCall(messages,{env,outputMode,fetchImpl,timeoutMs=40000}){
  const started=Date.now();let headersAt=null;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const result=await createAnthropicShadowResponse(messages,{env,fetchImpl,signal:controller.signal,outputMode,onPhase:(phase)=>{if(phase==="body"&&!headersAt)headersAt=Date.now();}});
    return{result,metrics:{first_byte_ms:headersAt?headersAt-started:null,total_latency_ms:Date.now()-started,input_tokens:Number(result.usage?.input_tokens||0),output_tokens:Number(result.usage?.output_tokens||0),estimated_cost_usd:costUsd(result.usage),timeout_class:null}};
  }catch(error){return{error,metrics:{first_byte_ms:null,total_latency_ms:Date.now()-started,input_tokens:0,output_tokens:0,estimated_cost_usd:0,timeout_class:error?.name==="AbortError"?"headers_first_byte_timeout":"provider_error"}};}
  finally{clearTimeout(timer);}
}

async function repairProviderCall(invalidText,{env,fetchImpl,timeoutMs=40000}){
  const started=Date.now();let headersAt=null;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const result=await createAnthropicShadowRepairResponse(invalidText,{env,fetchImpl,signal:controller.signal,onPhase:(phase)=>{if(phase==="body"&&!headersAt)headersAt=Date.now();}});
    return{result,metrics:{first_byte_ms:headersAt?headersAt-started:null,total_latency_ms:Date.now()-started,input_tokens:Number(result.usage?.input_tokens||0),output_tokens:Number(result.usage?.output_tokens||0),estimated_cost_usd:costUsd(result.usage),timeout_class:null}};
  }catch(error){return{error,metrics:{first_byte_ms:null,total_latency_ms:Date.now()-started,input_tokens:0,output_tokens:0,estimated_cost_usd:0,timeout_class:error?.name==="AbortError"?"headers_first_byte_timeout":"provider_error"}};}
  finally{clearTimeout(timer);}
}

export async function runShadowOutputAbFixture(fixtureId,{env=process.env,fetchImpl=fetch,timeoutMs=40000}={}){
  const fixture=SHADOW_OUTPUT_AB_FIXTURES[fixtureId];if(!fixture)throw new Error("fixture_not_allowlisted");
  const messages=[{role:"system",content:`${REAL_SHADOW_AI_SYSTEM_PROMPT}\n\n${REAL_SHADOW_AI_TOOL_GUIDE}`},{role:"user",content:JSON.stringify({evaluationMode:"synthetic_output_ab",message:fixture.message,metadata:fixture.metadata,toolResults:[]})}];
  const structured=await providerCall(messages,{env,outputMode:"anthropic_json_schema",fetchImpl,timeoutMs});
  const textual=await providerCall(messages,{env,outputMode:"text_json_local",fetchImpl,timeoutMs});
  let structuredDecision=null,textualDecision=null,textTelemetry={parse_success:false,schema_success:false,repair_attempted:false,repair_success:false,invalid_output:true};let repairMetrics=null;
  if(structured.result){try{structuredDecision=parseAndValidateShadowAiText(structured.result.text).decision;}catch{/* fail closed */}}
  if(textual.result){
    try{
      const validated=await validateWithSingleRepair(textual.result.text,{repair:async(invalidText)=>{
        const repair=await repairProviderCall(invalidText,{env,fetchImpl,timeoutMs});
        repairMetrics=repair.metrics;if(repair.error)throw repair.error;return repair.result;
      }});
      textualDecision=validated.decision;textTelemetry=validated.telemetry;
    }catch(error){textTelemetry=error.outputTelemetry||textTelemetry;}
  }
  return{fixture_id:fixtureId,structured:{...structured.metrics,parse_success:Boolean(structuredDecision),schema_success:Boolean(structuredDecision),invalid_output:Boolean(structured.result&&!structuredDecision)},text_json_local:{...textual.metrics,...textTelemetry,repair_metrics:repairMetrics},semantic_equivalence:Boolean(structuredDecision&&textualDecision&&semanticallyEquivalentShadowDecision(structuredDecision,textualDecision))};
}

export async function runShadowOutputAbVariant(fixtureId,variant,{env=process.env,fetchImpl=fetch,timeoutMs=40000}={}){
  const fixture=SHADOW_OUTPUT_AB_FIXTURES[fixtureId];if(!fixture)throw new Error("fixture_not_allowlisted");
  if(!["structured","text_json_local"].includes(variant))throw new Error("variant_not_allowlisted");
  const messages=[{role:"system",content:`${REAL_SHADOW_AI_SYSTEM_PROMPT}\n\n${REAL_SHADOW_AI_TOOL_GUIDE}`},{role:"user",content:JSON.stringify({evaluationMode:"synthetic_output_ab",message:fixture.message,metadata:fixture.metadata,toolResults:[]})}];
  const provider=await providerCall(messages,{env,outputMode:variant==="structured"?"anthropic_json_schema":"text_json_local",fetchImpl,timeoutMs});
  let decision=null;let telemetry={parse_success:false,schema_success:false,repair_attempted:false,repair_success:false,invalid_output:Boolean(provider.result)};let repairMetrics=null;
  if(provider.result&&variant==="structured"){
    try{decision=parseAndValidateShadowAiText(provider.result.text).decision;telemetry={...telemetry,parse_success:true,schema_success:true,invalid_output:false};}catch{/* fail closed */}
  }
  if(provider.result&&variant==="text_json_local"){
    try{
      const validated=await validateWithSingleRepair(provider.result.text,{repair:async(invalidText)=>{const repair=await repairProviderCall(invalidText,{env,fetchImpl,timeoutMs});repairMetrics=repair.metrics;if(repair.error)throw repair.error;return repair.result;}});
      decision=validated.decision;telemetry=validated.telemetry;
    }catch(error){telemetry=error.outputTelemetry||telemetry;}
  }
  return{fixture_id:fixtureId,variant,metrics:{...provider.metrics,...telemetry,repair_metrics:repairMetrics},semantic_projection:decision?semanticProjection(decision):null};
}
