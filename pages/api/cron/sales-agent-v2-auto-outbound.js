import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { processOneSalesAutoOutbound } from "../../../lib/agentsV2/salesAutoOutbound";

export const config={maxDuration:60};
const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,"Bearer "+process.env.CRON_SECRET))return res.status(401).json({ok:false,error:"not_authorized"});
  if(process.env.SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED!=="true")return res.status(200).json({ok:true,status:"disabled"});
  const admin=getAdminSupabase();
  try{
    const result=await processOneSalesAutoOutbound(admin,{env:process.env});
    return res.status(200).json({ok:true,...result});
  }catch(error){
    console.error("[sales-agent-v2-auto-outbound]",String(error?.message||"sales_auto_outbound_failed").slice(0,160));
    return res.status(503).json({ok:false,error:"sales_auto_outbound_failed"});
  }
}
