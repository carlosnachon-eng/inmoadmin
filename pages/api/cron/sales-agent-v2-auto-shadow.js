import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { runSalesAgentV2ShadowMessage } from "../../../lib/agentsV2/runSalesShadowMessage";

export const config={maxDuration:120};
const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};

async function nextInbound(admin){
  let query=admin.from("sales_agent_v2_inbound_messages")
    .select("id,event_id,external_message_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status")
    .eq("status","captured")
    .order("occurred_at",{ascending:true})
    .limit(1);
  const cutoff=process.env.SALES_AGENT_V2_AUTO_NOT_BEFORE;
  if(cutoff) query=query.gte("occurred_at",cutoff);
  const {data,error}=await query.maybeSingle();
  if(error)throw error;
  return data||null;
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(!["GET","POST"].includes(req.method)) return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,"Bearer "+process.env.CRON_SECRET)) return res.status(401).json({ok:false,error:"not_authorized"});
  if(process.env.SALES_AGENT_V2_AUTO_SHADOW_ENABLED!=="true") return res.status(200).json({ok:true,status:"disabled"});

  const admin=getAdminSupabase();
  const inbound=await nextInbound(admin);
  if(!inbound) return res.status(200).json({ok:true,status:"idle"});

  try{
    const result=await runSalesAgentV2ShadowMessage(admin,inbound,{env:process.env});
    const completedAt=new Date().toISOString();
    const {error:runError}=await admin.from("sales_agent_v2_shadow_runs").insert({
      inbound_message_id:inbound.id,
      session_id:result.sessionId,
      status:result.status==="idle"?"idle":"failed",
      called_tools:result.calledTools,
      proposed_response:result.output||null,
      latency_ms:result.latencyMs,
      error_code:result.error?.code||result.error?.message||null,
      completed_at:completedAt,
    });
    if(runError)throw runError;
    await admin.from("sales_agent_v2_inbound_messages").update({status:result.status==="idle"?"processed":"failed"}).eq("id",inbound.id);
    return res.status(200).json({ok:true,status:"processed",inboundMessageId:inbound.id,runStatus:result.status,calledTools:result.calledTools,latencyMs:result.latencyMs});
  }catch(error){
    await admin.from("sales_agent_v2_inbound_messages").update({status:"failed"}).eq("id",inbound.id);
    const existing=await admin.from("sales_agent_v2_shadow_runs").select("id").eq("inbound_message_id",inbound.id).maybeSingle();
    if(!existing.data){
      await admin.from("sales_agent_v2_shadow_runs").insert({
        inbound_message_id:inbound.id,
        session_id:"failed-"+inbound.id,
        status:"failed",
        called_tools:[],
        proposed_response:null,
        error_code:String(error?.message||"sales_v2_shadow_failed").slice(0,160),
        completed_at:new Date().toISOString(),
      });
    }
    console.error("[sales-agent-v2-auto-shadow]",error?.message||error);
    return res.status(503).json({ok:false,error:"sales_agent_v2_auto_shadow_failed"});
  }
}
