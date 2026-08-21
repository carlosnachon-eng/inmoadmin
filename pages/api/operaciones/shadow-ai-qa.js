import { createClient } from "@supabase/supabase-js";
import { DEV_PROJECT_REF, assertSupabaseEnvironment, getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { classifyShadowMessage, syntheticEnvelope } from "../../../lib/shadow/coordinator";
import { DEFAULT_SHADOW_AI_MODEL } from "../../../lib/shadow/ai/anthropic";
import { SHADOW_AI_PROMPT_VERSION } from "../../../lib/shadow/ai/prompt";
import { SHADOW_AI_QA_DATASET } from "../../../lib/shadow/ai/qaDataset";
import { aggregatePersistedShadowQa, executionDisposition, remainingRunBudget, SHADOW_QA_MIN_RUN_BUDGET_MS, validateExplicitFixtureIds } from "../../../lib/shadow/ai/qaOrchestrator";
import { runShadowAi } from "../../../lib/shadow/ai/runner";
import { processShadowEnvelope } from "../../../lib/shadow/pipeline";

export const config = { maxDuration: 120 };
const client = (key, token) => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined, auth: { persistSession: false, autoRefreshToken: false } });
async function authorize(req) {
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,""); const auth=client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,token);
  const {data:{user}}=await auth.auth.getUser(token); if(!user)return false;
  const {data}=await auth.from("profiles").select("role_id,active").eq("id",user.id).maybeSingle(); return Boolean(data?.active&&["admin","coord_operaciones"].includes(data.role_id));
}
async function audit(admin) {
  const [messages,runs,decisions]=await Promise.all([
    admin.from("shadow_messages").select("id,provider_metadata").eq("provider","synthetic").limit(250),
    admin.from("shadow_ai_runs").select("id,message_id,status,model,prompt_version,started_at,created_at,latency_ms,input_tokens,output_tokens,estimated_cost_usd,telemetry_json").eq("model",process.env.SHADOW_AI_MODEL||DEFAULT_SHADOW_AI_MODEL).eq("prompt_version",SHADOW_AI_PROMPT_VERSION).order("created_at",{ascending:false}).limit(250),
    admin.from("shadow_ai_decisions").select("ai_run_id,decision_json,tool_summary").limit(250),
  ]); const failure=[messages,runs,decisions].find((item)=>item.error)?.error;if(failure)throw failure;
  return aggregatePersistedShadowQa({messages:messages.data||[],runs:runs.data||[],decisions:decisions.data||[]});
}
export default async function handler(req,res) {
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"Método no permitido."});
  try {
    const environment=assertSupabaseEnvironment(); if(environment.projectRef!==DEV_PROJECT_REF||environment.env==="production")return res.status(403).json({ok:false,error:"QA P3 bloqueada fuera de DEV."});
    if(process.env.SHADOW_AI_ALLOW_REAL_MESSAGES!=="false"||process.env.SHADOW_OUTBOUND_ENABLED!=="false")return res.status(403).json({ok:false,error:"Guardas QA inválidas."});
    if(!await authorize(req))return res.status(403).json({ok:false,error:"No autorizado."});
    const admin=getAdminSupabase(); if(req.method==="GET")return res.status(200).json({ok:true,...await audit(admin)});
    const fixtureIds=validateExplicitFixtureIds(req.body?.fixtureIds); const requested=new Map(SHADOW_AI_QA_DATASET.filter((item)=>fixtureIds.includes(item.id)).map((item)=>[item.id,item]));
    const startedAt=Date.now(); const results=[];
    for(const fixtureId of fixtureIds){
      const scenario=requested.get(fixtureId); const envelope=syntheticEnvelope({id:scenario.id,text:scenario.text,metadata:scenario.metadata});
      const {data:existing,error:messageLookupError}=await admin.from("shadow_messages").select("id").eq("provider","synthetic").eq("external_message_id",envelope.externalMessageId).maybeSingle(); if(messageLookupError)throw messageLookupError;
      const ingested=existing?{messageId:existing.id}:await processShadowEnvelope(admin,envelope); if(!ingested?.messageId){results.push({fixtureId,status:"message_not_ingested",runId:null});continue;}
      const {data:latest,error}=await admin.from("shadow_ai_runs").select("id,status").eq("message_id",ingested.messageId).eq("model",process.env.SHADOW_AI_MODEL||DEFAULT_SHADOW_AI_MODEL).eq("prompt_version",SHADOW_AI_PROMPT_VERSION).order("created_at",{ascending:false}).limit(1).maybeSingle(); if(error)throw error;
      const disposition=executionDisposition(latest?.status); if(disposition!=="execute"){results.push({fixtureId,status:disposition,runId:latest?.id||null,previousStatus:latest?.status||null});continue;}
      const budget=remainingRunBudget(startedAt,Date.now()); if(budget<SHADOW_QA_MIN_RUN_BUDGET_MS){results.push({fixtureId,status:"deferred_request_budget",runId:null});continue;}
      const outcome=await runShadowAi(admin,{messageId:ingested.messageId,envelope,deterministic:classifyShadowMessage(envelope)},{env:{...process.env,SHADOW_AI_GLOBAL_TIMEOUT_MS:String(budget)}});
      results.push({fixtureId,status:outcome.status,runId:outcome.runId||null});
    }
    return res.status(200).json({ok:true,requested:fixtureIds,results,pending:(await audit(admin)).missingFixtures});
  } catch(error){const bad=/^invalid_fixture_/.test(error?.message||"");return res.status(bad?400:500).json({ok:false,error:bad?"Lista de fixtures inválida.":"Falló orquestación QA P3."});}
}
