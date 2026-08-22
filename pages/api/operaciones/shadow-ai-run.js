import { createClient } from "@supabase/supabase-js";
import { DEV_PROJECT_REF, assertSupabaseEnvironment, getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { classifyShadowMessage, syntheticEnvelope } from "../../../lib/shadow/coordinator";
import { SHADOW_AI_LIMITS } from "../../../lib/shadow/ai/guards";
import { SHADOW_AI_QA_DATASET, evaluateShadowAiQa } from "../../../lib/shadow/ai/qaDataset";
import { runShadowAi } from "../../../lib/shadow/ai/runner";
import { processShadowEnvelope } from "../../../lib/shadow/pipeline";

export const config = { maxDuration: 120 };

async function authorized(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: { user } } = await auth.auth.getUser(token); if (!user) return false;
  const { data } = await auth.from("profiles").select("role_id,active").eq("id", user.id).maybeSingle();
  return Boolean(data?.active && ["admin","coord_operaciones"].includes(data.role_id));
}
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false,error:"Método no permitido." });
  try {
    const environment = assertSupabaseEnvironment();
    if (environment.projectRef !== DEV_PROJECT_REF || environment.env === "production") return res.status(403).json({ok:false,error:"IA P3 bloqueada fuera de DEV."});
    if (!await authorized(req)) return res.status(403).json({ok:false,error:"No autorizado."});
    const requested = Array.isArray(req.body?.fixtureIds) ? req.body.fixtureIds.slice(0, SHADOW_AI_LIMITS.maxBatch) : [];
    const scenarios = requested.length ? SHADOW_AI_QA_DATASET.filter((x)=>requested.includes(x.id)) : SHADOW_AI_QA_DATASET.slice(0,1);
    const admin = getAdminSupabase(); const results=[];
    for (const scenario of scenarios) {
      const envelope=syntheticEnvelope({id:scenario.id,text:scenario.text,metadata:scenario.metadata});
      const ingested=await processShadowEnvelope(admin,envelope);
      if (!ingested?.messageId) { results.push({fixtureId:scenario.id,status:"message_not_ingested"}); continue; }
      results.push({fixtureId:scenario.id,...await runShadowAi(admin,{messageId:ingested.messageId,envelope,deterministic:classifyShadowMessage(envelope)})});
    }
    return res.status(200).json({ok:true,results,metrics:evaluateShadowAiQa(scenarios,results)});
  } catch(error) { console.error("[shadow-ai-run]",error?.message||error); return res.status(500).json({ok:false,error:"Falló ejecución IA Shadow."}); }
}
