import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { processOneAdminAgentV2AutoOutbound } from "../../../lib/agentsV2/autoOutbound";

export const config={maxDuration:30};
const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,`Bearer ${process.env.CRON_SECRET}`))return res.status(401).json({ok:false,error:"not_authorized"});
  if(process.env.ADMIN_AGENT_V2_AUTO_OUTBOUND_ENABLED!=="true")return res.status(200).json({ok:true,status:"disabled"});
  try{
    const result=await processOneAdminAgentV2AutoOutbound(getAdminSupabase(),{env:process.env});
    return res.status(200).json({ok:true,...result});
  }catch(error){
    const status=Number(error?.statusCode||503);
    console.error("[admin-agent-v2-auto-outbound]",String(error?.message||"v2_auto_outbound_failed").slice(0,120));
    return res.status(status).json({ok:false,error:status===409?"v2_auto_outbound_disabled":"v2_auto_outbound_failed"});
  }
}
