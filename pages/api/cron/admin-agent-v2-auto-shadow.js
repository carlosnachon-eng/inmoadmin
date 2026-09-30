import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { runAdminAgentV2RealShadowMessage } from "../../../lib/agentsV2/runRealShadowMessage";

export const config = { maxDuration: 120 };
const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};

async function nextMessage(admin) {
  const { data, error } = await admin
    .from("shadow_messages")
    .select("id,conversation_id,occurred_at,provider,direction,attachment_metadata,sanitized_text,external_message_id")
    .eq("provider","respond_admin")
    .eq("direction","inbound")
    .gte("occurred_at", process.env.ADMIN_AGENT_V2_AUTO_NOT_BEFORE || new Date(Date.now()-86400000).toISOString())
    .order("occurred_at",{ascending:true})
    .limit(50);
  if (error) throw error;
  for (const message of data || []) {
    if ((message.attachment_metadata || []).length) {
      const { data: interpretation, error: interpretationError } = await admin
        .from("shadow_media_interpretations")
        .select("id")
        .eq("provider","respond_admin")
        .eq("external_message_id",message.external_message_id)
        .eq("status","completed")
        .limit(1)
        .maybeSingle();
      if (interpretationError) throw interpretationError;
      if (!interpretation) continue;
    } else if (!String(message.sanitized_text || "").trim()) continue;
    const { data: existing, error: existingError } = await admin
      .from("admin_agent_v2_shadow_runs")
      .select("id")
      .eq("message_id",message.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return message;
  }
  return null;
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(!["GET","POST"].includes(req.method)) return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,`Bearer ${process.env.CRON_SECRET}`)) return res.status(401).json({ok:false,error:"not_authorized"});
  if(process.env.ADMIN_AGENT_V2_AUTO_SHADOW_ENABLED!=="true") return res.status(200).json({ok:true,status:"disabled"});
  const admin=getAdminSupabase();
  try{
    const message=await nextMessage(admin);
    if(!message) return res.status(200).json({ok:true,status:"idle"});
    let result;
    try{
      result=await runAdminAgentV2RealShadowMessage(admin,message.id,{env:process.env});
    }catch(error){
      await admin.from("admin_agent_v2_shadow_runs").insert({
        message_id:message.id,
        conversation_id:message.conversation_id,
        session_id:`failed-${message.id}`,
        status:"failed",
        called_tools:[],
        proposed_response:null,
        latency_ms:null,
        error_code:String(error?.message||"v2_auto_failed").slice(0,160),
        completed_at:new Date().toISOString(),
      });
      throw error;
    }
    const { error: persistError }=await admin.from("admin_agent_v2_shadow_runs").insert({
      message_id:message.id,
      conversation_id:result.conversationId,
      session_id:result.sessionId,
      status:result.status==="idle"?"idle":"failed",
      called_tools:result.calledTools,
      proposed_response:result.output||null,
      latency_ms:result.latencyMs,
      error_code:result.error?.code||result.error?.message||null,
      completed_at:new Date().toISOString(),
    });
    if(persistError) throw persistError;
    return res.status(200).json({ok:true,status:"processed",messageId:message.id,runStatus:result.status,calledTools:result.calledTools,latencyMs:result.latencyMs});
  }catch(error){
    console.error("[admin-agent-v2-auto-shadow]",error?.message||error);
    return res.status(503).json({ok:false,error:"admin_agent_v2_auto_shadow_failed"});
  }
}
