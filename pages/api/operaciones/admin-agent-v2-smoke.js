import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter.js";
import {
  assertAdminAgentV2Environment,
  createAdminAgentV2Session,
  executeAdminAgentV2RequiredActions,
  retrieveAdminAgentV2Session,
} from "../../../lib/agentsV2/openaiAdminAgent.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listItems(sessionId, env=process.env) {
  const response = await fetch(`https://api.openai.com/v1/agents/sessions/${encodeURIComponent(sessionId)}/items?order=asc&limit=100`, {
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "agents=v1",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`admin_agent_v2_items_failed_${response.status}`);
  return Array.isArray(body?.data) ? body.data : [];
}

function safeItem(item) {
  const type = String(item?.type || item?.object || "unknown").slice(0,80);
  const role = item?.role ? String(item.role).slice(0,40) : null;
  const name = item?.name ? String(item.name).slice(0,80) : null;
  const status = item?.status ? String(item.status).slice(0,40) : null;
  const content = Array.isArray(item?.content) ? item.content.map((part) => {
    if (typeof part?.text === "string") return { type:part.type || "text", text:part.text.slice(0,1200) };
    if (typeof part?.output_text === "string") return { type:part.type || "output_text", text:part.output_text.slice(0,1200) };
    return { type:String(part?.type || "unknown").slice(0,80) };
  }).slice(0,8) : [];
  return { type, role, name, status, content };
}

export default async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");
  if (req.method !== "GET") return res.status(405).json({ok:false,error:"method_not_allowed"});
  if (process.env.VERCEL_ENV !== "preview" || process.env.SUPABASE_ENVIRONMENT !== "dev") {
    return res.status(403).json({ok:false,error:"preview_dev_only"});
  }
  if (req.query?.confirm !== "synthetic-v2-smoke") return res.status(403).json({ok:false,error:"explicit_smoke_confirmation_required"});
  try {
    assertAdminAgentV2Environment(process.env);
    const db=getAdminSupabase();
    const input=[
      "respondContactId opaco: V2-SYNTHETIC-NO-LINK",
      "Mensaje del cliente:",
      "Hola, ya hice el pago de la renta. ¿Me confirman si quedó registrado?",
      "Este es un caso sintético de evaluación. No inventes identidad ni datos.",
    ].join("\n");
    let session=await createAdminAgentV2Session({input});
    const calledTools=[];
    let terminal=null;
    for(let step=0;step<60;step+=1){
      session=await retrieveAdminAgentV2Session({sessionId:session.id});
      if(session.status==="requires_action"){
        for(const action of session.required_actions||[]) calledTools.push(String(action?.name||action?.type||"unknown").slice(0,80));
        const handled=await executeAdminAgentV2RequiredActions({db,session});
        if(!handled.handled) throw new Error("admin_agent_v2_unhandled_required_action");
        await sleep(250);
        continue;
      }
      if(session.status==="failed"){terminal="failed";break;}
      if(session.status==="idle"){terminal="idle";break;}
      await sleep(500);
    }
    session=await retrieveAdminAgentV2Session({sessionId:session.id});
    const items=await listItems(session.id);
    return res.status(200).json({
      ok:true,
      mode:"synthetic_read_only_preview",
      sessionId:session.id,
      sessionStatus:session.status,
      terminal,
      calledTools,
      outbound:false,
      production:false,
      usage: session.usage || null,
      error: session.error || null,
      items:items.map(safeItem).slice(-20),
    });
  } catch(error) {
    return res.status(500).json({ok:false,error:String(error?.message||"admin_agent_v2_smoke_failed").slice(0,180)});
  }
}
