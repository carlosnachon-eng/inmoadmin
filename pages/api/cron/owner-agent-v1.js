import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { processOwnerInboundById } from "../../../lib/agentsV2/processOwnerInbound";

export const config={maxDuration:120};
const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,"Bearer "+process.env.CRON_SECRET))return res.status(401).json({ok:false,error:"not_authorized"});

  const admin=getAdminSupabase();
  const now=new Date().toISOString();
  const {data,error}=await admin.from("owner_agent_v1_inbound_messages")
    .select("id")
    .eq("status","captured")
    .or("debounce_until.is.null,debounce_until.lte."+now)
    .order("occurred_at",{ascending:false})
    .limit(1);
  if(error)throw error;
  const inbound=(data||[])[0];
  if(!inbound)return res.status(200).json({ok:true,status:"idle"});

  try{
    const result=await processOwnerInboundById(admin,inbound.id,{env:process.env});
    return res.status(200).json({ok:true,...result});
  }catch(error){
    console.error("[owner-ai-cron]",String(error?.message||"owner_cron_failed").slice(0,160));
    return res.status(503).json({ok:false,error:"owner_agent_failed"});
  }
}
