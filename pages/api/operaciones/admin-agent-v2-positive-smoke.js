import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter.js";
import {
  assertAdminAgentV2Environment,
  createAdminAgentV2Session,
  executeAdminAgentV2RequiredActions,
  retrieveAdminAgentV2Session,
} from "../../../lib/agentsV2/openaiAdminAgent.js";

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

async function listItems(sessionId,env=process.env){
  const response=await fetch(`https://api.openai.com/v1/agents/sessions/${encodeURIComponent(sessionId)}/items?order=asc&limit=100`,{
    headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,"OpenAI-Beta":"agents=v1"},
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(`admin_agent_v2_items_failed_${response.status}`);
  return Array.isArray(body?.data)?body.data:[];
}
function safeItem(item){
  return {
    type:String(item?.type||item?.object||"unknown").slice(0,80),
    role:item?.role?String(item.role).slice(0,40):null,
    name:item?.name?String(item.name).slice(0,80):null,
    status:item?.status?String(item.status).slice(0,40):null,
    content:Array.isArray(item?.content)?item.content.map((part)=>({
      type:String(part?.type||"unknown").slice(0,80),
      text:typeof part?.text==="string"?part.text.slice(0,1600):typeof part?.output_text==="string"?part.output_text.slice(0,1600):null,
    })).slice(0,12):[],
  };
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(process.env.VERCEL_ENV!=="preview"||process.env.SUPABASE_ENVIRONMENT!=="dev") return res.status(403).json({ok:false,error:"preview_dev_only"});
  if(req.query?.confirm!=="synthetic-v2-positive") return res.status(403).json({ok:false,error:"explicit_smoke_confirmation_required"});
  try{
    assertAdminAgentV2Environment(process.env);
    const db=getAdminSupabase();
    const input=[
      "respondContactId opaco: V2-SYNTHETIC-CONFIRMED",
      "Mensaje del cliente:",
      "Hola, ya hice el pago de la renta de septiembre. ¿Me confirman si quedó registrado?",
      "Este es un caso sintético de evaluación. Usa sólo datos verificados y no confirmes recepción bancaria si el registro no lo acredita.",
    ].join("\n");
    let session=await createAdminAgentV2Session({input});
    const calledTools=[];
    for(let step=0;step<80;step+=1){
      session=await retrieveAdminAgentV2Session({sessionId:session.id});
      if(session.status==="requires_action"){
        for(const action of session.required_actions||[]) calledTools.push(String(action?.name||action?.type||"unknown").slice(0,80));
        const handled=await executeAdminAgentV2RequiredActions({db,session});
        if(!handled.handled) throw new Error("admin_agent_v2_unhandled_required_action");
        await sleep(200);
        continue;
      }
      if(session.status==="failed") break;
      if(session.status==="idle") break;
      await sleep(400);
    }
    session=await retrieveAdminAgentV2Session({sessionId:session.id});
    const items=await listItems(session.id);
    return res.status(200).json({
      ok:true,mode:"synthetic_positive_read_only_preview",sessionId:session.id,
      sessionStatus:session.status,error:session.error||null,calledTools,
      outbound:false,production:false,items:items.map(safeItem).slice(-24),
    });
  }catch(error){
    return res.status(500).json({ok:false,error:String(error?.message||"admin_agent_v2_positive_smoke_failed").slice(0,180)});
  }
}
